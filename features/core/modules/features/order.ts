export interface FeatureNode {
  name: string;
  // Required features load first
  dependsOn: readonly string[];
}

// Independent features keep their original order whenever possible
export const orderFeatures = <F extends FeatureNode>(features: readonly F[]): F[] => {
  const ordered: F[] = [];
  const visit = (feature: F, path: readonly string[]): void => {
    if (ordered.includes(feature)) {
      return;
    }
    if (path.includes(feature.name)) {
      throw new Error(`Circular feature dependency: ${[...path, feature.name].join(" -> ")}`);
    }
    for (const name of feature.dependsOn) {
      const dependency = features.find((other) => other.name === name);
      if (dependency === undefined) {
        throw new Error(`Feature "${feature.name}" depends on feature "${name}", which is not part of the build`);
      }
      visit(dependency, [...path, feature.name]);
    }
    ordered.push(feature);
  };
  for (const feature of features) {
    visit(feature, []);
  }
  return ordered;
};
