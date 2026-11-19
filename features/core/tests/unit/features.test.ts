import { describe, expect, it } from "vitest";

import { readIntegrations, resolveIntegrations } from "#layers/core/modules/features/integrations";
import { orderFeatures } from "#layers/core/modules/features/order";
import { selectFeatures } from "#layers/core/modules/features/selection";
import coreFeature from "#layers/core/server/feature";
import { defineSharedResource } from "#layers/core/server/lib/authz/resources";
import { migrateToLatest } from "#layers/core/server/lib/database/migrator";
import { composeSecurity } from "#layers/core/server/lib/database/security";
import { assertFeaturePrefix } from "#layers/core/server/lib/features/define";

describe("feature registry", () => {
  it("sets up features after the ones they depend on", () => {
    const ordered = orderFeatures([
      { name: "core", dependsOn: [] },
      { name: "reports", dependsOn: ["files"] },
      { name: "files", dependsOn: [] },
    ]);
    expect(ordered.map((feature) => feature.name)).toEqual(["core", "files", "reports"]);
    expect(() => orderFeatures([{ name: "reports", dependsOn: ["files"] }])).toThrow(
      /Feature "reports" depends on feature "files", which is not part of the build/,
    );
    expect(() => {
      return orderFeatures([
        { name: "a", dependsOn: ["b"] },
        { name: "b", dependsOn: ["a"] },
      ]);
    }).toThrow(/Circular feature dependency: a -> b -> a/);
  });

  it("leaves the optional features out of the builds that do not ask for them", () => {
    const features = [
      { name: "files", optional: false },
      { name: "reports", optional: true },
      { name: "core", optional: true },
    ];
    expect(selectFeatures(features)).toEqual(["files", "core"]);
    expect(selectFeatures(features, " reports, ")).toEqual(["reports", "core"]);
    expect(() => selectFeatures(features, "files,charts")).toThrow(/Unknown feature "charts" in FEATURES/);
  });

  it("imports the adapter of an integration only in the builds with its companion feature", () => {
    const integrations = readIntegrations("reports", {
      files: {
        adapter: "app/integrations/files.ts",
        fallback: "app/integrations/disabled.ts",
        files: ["tests/unit/files-*.test.ts"],
      },
    });
    const reports = { name: "reports", root: "/app/features/reports", integrations };

    expect(resolveIntegrations([reports], ["files", "reports", "core"])).toEqual({
      aliases: { "#features/reports-files": "/app/features/reports/app/integrations/files.ts" },
      excludedPaths: [],
    });
    expect(resolveIntegrations([reports], ["reports", "core"])).toEqual({
      aliases: { "#features/reports-files": "/app/features/reports/app/integrations/disabled.ts" },
      excludedPaths: [
        "/app/features/reports/app/integrations/files.ts",
        "/app/features/reports/tests/unit/files-*.test.ts",
      ],
    });
    expect(readIntegrations("reports")).toEqual({});
    expect(() => readIntegrations("reports", { files: { adapter: "app/integrations/files.ts" } })).toThrow(
      /Feature "reports" must set each entry of the "\$meta.integrations" option/,
    );
  });

  it("rejects duplicated feature names before migrating", async () => {
    await expect(migrateToLatest(null as never, [{ name: "a" }, { name: "a" }])).rejects.toThrow(
      /Duplicate feature "a"/,
    );
  });

  it("rejects resource types registered twice", () => {
    const resource = defineSharedResource({ type: "files_item", table: "files_items" });
    expect(() => composeSecurity([{ name: "files", security: { sharedResources: [resource, resource] } }])).toThrow(
      /Duplicate resource type "files_item" in feature "files"/,
    );
  });

  it("requires names outside core to start with the name of their feature", () => {
    expect(() => {
      assertFeaturePrefix("core", "users", "Table");
    }).not.toThrow();
    expect(() => {
      assertFeaturePrefix("inventory", "inventory_items", "Table");
    }).not.toThrow();
    expect(() => {
      assertFeaturePrefix("inventory", "inventory.pageSize", "Setting", ".");
    }).not.toThrow();
    expect(() => {
      assertFeaturePrefix("inventory", "items", "Table");
    }).toThrow(/Table "items" of feature "inventory" must start with "inventory_"/);

    const resource = defineSharedResource({ type: "file", table: "files" });
    expect(() => composeSecurity([coreFeature, { name: "files", security: { sharedResources: [resource] } }])).toThrow(
      /Resource type "file" of feature "files"/,
    );
    const helper = "CREATE FUNCTION security.helper() RETURNS BOOLEAN LANGUAGE SQL AS $$ SELECT TRUE $$";
    expect(() => composeSecurity([coreFeature, { name: "files", security: { statements: () => [helper] } }])).toThrow(
      /Function "helper" of feature "files"/,
    );
  });

  it("rejects unregistered resource types in policies", () => {
    const policy = "CREATE POLICY files_select ON public.files USING (security.has_access('file', id))";
    expect(() => composeSecurity([coreFeature, { name: "a", security: { statements: () => [policy] } }])).toThrow(
      /Resource type "file" used in security.has_access\(\) is not registered/,
    );
  });
});
