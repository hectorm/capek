export interface FeatureNode {
  name: string;
  // Features it builds on, which have to be part of the build and are set up before it
  dependsOn: readonly string[];
}

// Places each feature after the features it depends on, keeping the given order otherwise
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
