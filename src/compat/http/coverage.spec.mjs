export const httpCoverageCases = {
  httpHeaderValidatorCoverage: function ({ http, httpOutgoing }) {
    const out = {
      identity: [
        http.validateHeaderName === httpOutgoing.validateHeaderName,
        http.validateHeaderValue === httpOutgoing.validateHeaderValue,
      ],
    };
    for (const name of ["validateHeaderName", "validateHeaderValue"])
      for (const [index, args] of (name === "validateHeaderName"
        ? [["x-test"], [""], ["x\n"], [null], [42]]
        : [
            ["x-test", "ok"],
            ["x-test", undefined],
            ["x-test", "a\nb"],
            ["x-test", 3],
            ["x-test", null],
          ]
      ).entries()) {
        const id = name + "/" + index;
        try {
          out[id] = { returnedUndefined: http[name](...args) === undefined };
        } catch (e) {
          out[id] = {
            error: { name: e.name, code: e.code ?? null, message: e.message },
          };
        }
      }
    return out;
  },
};
