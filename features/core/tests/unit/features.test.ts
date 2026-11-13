import { describe, expect, it } from "vitest";

import { orderFeatures } from "#layers/core/modules/features/order";
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
      assertFeaturePrefix("ai", "ai_agents", "Table");
    }).not.toThrow();
    expect(() => {
      assertFeaturePrefix("ai", "ai.quickChats", "Setting", ".");
    }).not.toThrow();
    expect(() => {
      assertFeaturePrefix("ai", "agents", "Table");
    }).toThrow(/Table "agents" of feature "ai" must start with "ai_"/);

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
