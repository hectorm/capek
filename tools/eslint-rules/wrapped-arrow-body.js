export default {
  meta: {
    type: "layout",
    fixable: "code",
    messages: { block: "Return the body of a wrapped arrow function from a block." },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      ArrowFunctionExpression(node) {
        if (node.body.type === "BlockStatement") {
          return;
        }
        const arrow = sourceCode.getTokenBefore(node.body, { filter: (token) => token.value === "=>" });
        const next = sourceCode.getTokenAfter(arrow, { includeComments: true });
        if (arrow.loc.end.line === next.loc.start.line) {
          return;
        }
        context.report({
          node: node.body,
          messageId: "block",
          fix:
            next.type === "Line" || next.type === "Block"
              ? null
              : (fixer) => {
                  const body = sourceCode.text.slice(next.range[0], node.range[1]);
                  return fixer.replaceTextRange([arrow.range[1], node.range[1]], ` {\n  return ${body};\n}`);
                },
        });
      },
    };
  },
};
