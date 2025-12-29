#!/usr/bin/env node
import os from "node:os";
import process from "node:process";

if (process.env.NUXT_DATABASE_URL?.startsWith("file:")) {
  process.env.NITRO_CLUSTER_WORKERS = "1";
} else if (!process.env.NITRO_CLUSTER_WORKERS) {
  process.env.NITRO_CLUSTER_WORKERS = Math.min(8, os.cpus().length);
}

await import(process.argv[2]);
