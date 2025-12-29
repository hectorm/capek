#!/usr/bin/env node
import process from "node:process";

try {
  const response = await fetch(`${process.argv[2]}/api/healthz`);
  if (response.ok) {
    process.stdout.write("OK\n");
    process.exit(0);
  }
} catch {
  // Ignore errors
}

process.stdout.write("KO\n");
process.exit(1);
