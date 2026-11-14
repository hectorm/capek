const CONSTANT_CASE = /^[A-Z][A-Z0-9_]*$/;
const ARITHMETIC = new Set(["+", "-", "*", "/", "%", "**"]);

const isPrimitive = (node) => {
  switch (node.type) {
    case "Literal":
      return typeof node.value === "number" || typeof node.value === "string" || Boolean(node.regex);
    case "TemplateLiteral":
      return node.expressions.length === 0;
    case "UnaryExpression":
      return node.operator === "-" && isPrimitive(node.argument);
    case "BinaryExpression":
      return ARITHMETIC.has(node.operator) && isPrimitive(node.left) && isPrimitive(node.right);
    case "TSAsExpression":
      return isPrimitive(node.expression);
    default:
      return false;
  }
};

export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      case: 'Constant "{{name}}" holds a number, string or pattern, so it has to be named in CONSTANT_CASE.',
    },
  },
  create(context) {
    return {
      VariableDeclaration(node) {
        const scope = node.parent.type === "ExportNamedDeclaration" ? node.parent.parent : node.parent;
        if (node.kind !== "const" || scope.type !== "Program") {
          return;
        }
        for (const { id, init } of node.declarations) {
          if (id.type === "Identifier" && init && isPrimitive(init) && !CONSTANT_CASE.test(id.name)) {
            context.report({ node: id, messageId: "case", data: { name: id.name } });
          }
        }
      },
    };
  },
};
