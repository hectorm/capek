import { lookup } from "node:dns";
import { BlockList, isIP, Socket } from "node:net";
import { networkInterfaces } from "node:os";
import type { LookupFunction } from "node:net";

import { useRuntimeConfig } from "nitropack/runtime/config";

const config = useRuntimeConfig();

export interface HostList {
  includesName: (hostname: string, port: string) => boolean;
  includesAddress: (address: string, port: string) => boolean;
}

export interface AllowedHost {
  name: string;
  nameAllowed: boolean;
  isAllowed: (address: string) => boolean;
  lookup: LookupFunction;
  resolve: (signal?: AbortSignal | null) => Promise<void>;
}

export type AllowedSocket = Socket & { connect: () => Socket };

export class HostNotAllowedError extends Error {
  public constructor(message = "The host resolves to a private IP address that is not allowed") {
    super(message);
    this.name = "HostNotAllowedError";
  }
}

const HOST_PATTERN = /^(\[[^\]/]+\]|[^:/[\]]+)(?::(\d+))?$/;
const DOMAIN_PATTERN = /^(\*?\.)?([a-z0-9_-]+(?:\.[a-z0-9_-]+)*)$/;

const BLOCKED_IP_RANGES = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32], // Azure platform endpoint
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  BLOCKED_IP_RANGES.addSubnet(address, prefix, isIP(address) === 4 ? "ipv4" : "ipv6");
}

// Global unicast IPv6 addresses and IPv4-mapped ones
const GLOBAL_IPV6_RANGES = new BlockList();
GLOBAL_IPV6_RANGES.addSubnet("2000::", 3, "ipv6");
GLOBAL_IPV6_RANGES.addSubnet("::ffff:0:0", 96, "ipv6");

// Parses a list of hosts with the syntax of NO_PROXY, like "localhost:9931, .svc.cluster.local, 10.20.0.0/16"
export const parseHostList = (list: string, { ignoreInvalid = false } = {}): HostList => {
  let all = false;
  const ranges = new Map<string, BlockList>();
  const domains: { name: string; port: string; subdomainsOnly: boolean }[] = [];

  const add = (value: string): void => {
    if (value === "*") {
      all = true;
      return;
    }
    if (value === "") {
      return;
    }

    const [, host = value, port = ""] = HOST_PATTERN.exec(value) ?? [];
    if (Number(port) > 65_535 || port.startsWith("0")) {
      throw new Error(`The host "${value}" has an invalid port`);
    }

    const [address = "", prefix, ...rest] = host.replace(/^\[(.+)\]$/, "$1").split("/");
    const family = isIP(address);
    if (family) {
      const bits = family === 4 ? 32 : 128;
      const length = Number(prefix ?? bits);
      if (rest.length > 0 || (prefix !== undefined && !/^\d+$/.test(prefix)) || length > bits) {
        throw new Error(`The host "${value}" has an invalid IP range`);
      }
      const portRanges = ranges.get(port) ?? new BlockList();
      portRanges.addSubnet(address, length, family === 4 ? "ipv4" : "ipv6");
      ranges.set(port, portRanges);
      return;
    }

    const [, wildcard, name] = DOMAIN_PATTERN.exec(host.replace(/\.$/, "")) ?? [];
    if (!name) {
      throw new Error(`The host "${value}" is not an IP address, IP range or domain`);
    }
    domains.push({ name, port, subdomainsOnly: wildcard !== undefined });
  };

  for (const entry of list.split(",")) {
    try {
      add(entry.trim().toLowerCase());
    } catch (error) {
      if (!ignoreInvalid) {
        throw error;
      }
    }
  }

  return {
    includesName: (hostname, port) => {
      if (all) {
        return true;
      }
      return (
        !isIP(hostname) &&
        domains.some((domain) => {
          const matches = hostname.endsWith(`.${domain.name}`) || (!domain.subdomainsOnly && hostname === domain.name);
          return matches && (domain.port === "" || domain.port === port);
        })
      );
    },
    includesAddress: (address, port) => {
      const family = isIP(address);
      const type = family === 4 ? "ipv4" : "ipv6";
      return family !== 0 && [ranges.get(""), ranges.get(port)].some((portRanges) => portRanges?.check(address, type));
    },
  };
};

const ownAddresses = (): BlockList => {
  const own = new BlockList();
  for (const info of Object.values(networkInterfaces()).flat()) {
    if (info) {
      own.addAddress(info.address, info.family === "IPv4" ? "ipv4" : "ipv6");
    }
  }
  return own;
};

const isPublicAddress = (address: string, own: BlockList): boolean => {
  const type = isIP(address) === 4 ? "ipv4" : "ipv6";
  return (
    !BLOCKED_IP_RANGES.check(address, type) &&
    (type === "ipv4" || GLOBAL_IPV6_RANGES.check(address, type)) &&
    !own.check(address, type)
  );
};

// Checks the addresses of a host, allowed when public or listed in the allowed private hosts
export const allowedHost = (host: string, port: string): AllowedHost => {
  const allowed = parseHostList(config.allowedPrivateHosts);
  const name = host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const nameAllowed = allowed.includesName(name, port);
  const own = ownAddresses();
  const isAllowed = (address: string): boolean => {
    return nameAllowed || isPublicAddress(address, own) || allowed.includesAddress(address, port);
  };

  if (isIP(name) && !isAllowed(name)) {
    throw new HostNotAllowedError();
  }

  const lookupAllowed: LookupFunction = (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "");
        return;
      }
      const first = addresses[0];
      if (!first || !addresses.every(({ address }) => isAllowed(address))) {
        callback(new HostNotAllowedError(), "");
        return;
      }
      callback(null, options.all ? addresses : first.address, first.family);
    });
  };

  const resolve = (signal?: AbortSignal | null): Promise<void> => {
    return new Promise((accept, reject) => {
      signal?.throwIfAborted();
      const abort = (): void => {
        reject(signal?.reason as Error);
      };
      signal?.addEventListener("abort", abort, { once: true });
      lookupAllowed(name, {}, (error) => {
        signal?.removeEventListener("abort", abort);
        if (error) {
          reject(error);
        } else {
          accept();
        }
      });
    });
  };

  return { name, nameAllowed, isAllowed, lookup: lookupAllowed, resolve };
};

// Socket that connects only to the allowed addresses of a host, or to the given one, whatever its connection arguments
export const allowedSocket = (host: string, port: number, address?: string): AllowedSocket => {
  const allowed = allowedHost(host, String(port));
  const checkedLookup: LookupFunction =
    address === undefined
      ? allowed.lookup
      : (_hostname, options, callback) => {
          if (!allowed.isAllowed(address)) {
            callback(new HostNotAllowedError(), "");
            return;
          }
          const family = isIP(address);
          callback(null, options.all ? [{ address, family }] : address, family);
        };
  const socket = new Socket();
  const connect = socket.connect.bind(socket);
  return Object.assign(socket, { connect: () => connect({ host: allowed.name, port, lookup: checkedLookup }) });
};

// Sockets that connect only to the allowed addresses of a host, all of them to the server of the first one
export const pinnedSockets = (host: string, port: number): (() => AllowedSocket) => {
  let address: string | undefined;
  return () => {
    const socket = allowedSocket(host, port, address);
    socket.once("connect", () => {
      address ??= socket.remoteAddress;
    });
    return socket;
  };
};
