// The host calls first and second in distinct request scopes.
export function createFsLifetimeContract(fs) {
  let held;
  return async (step, kind) => {
    if (step === "first") {
      fs.writeFileSync("/tmp/lifetime-read", "A");
      fs.writeFileSync("/tmp/lifetime-write", "A");
      const read =
        kind === "handle"
          ? (
              await fs.promises.open("/tmp/lifetime-read", "r")
            ).createReadStream()
          : fs.createReadStream("/tmp/lifetime-read");
      const write =
        kind === "handle"
          ? (
              await fs.promises.open("/tmp/lifetime-write", "w")
            ).createWriteStream()
          : fs.createWriteStream("/tmp/lifetime-write");
      const errors = [];
      read.on("error", (e) =>
        errors.push(["read", e.name, e.code ?? null, e.message]),
      );
      write.on("error", (e) =>
        errors.push(["write", e.name, e.code ?? null, e.message]),
      );
      if (kind !== "handle")
        await Promise.all([
          new Promise((resolve) => read.once("open", resolve)),
          new Promise((resolve) => write.once("open", resolve)),
        ]);
      held = { read, write, errors };
      return "ready";
    }
    fs.writeFileSync("/tmp/lifetime-read", "B");
    fs.writeFileSync("/tmp/lifetime-write", "B");
    const { read, write, errors } = held;
    let body = "";
    try {
      const values = await Promise.all([
        new Promise((resolve, reject) => {
          read.on("data", (chunk) => (body += chunk.toString()));
          read.once("end", () => resolve(body));
          read.once("error", reject);
          read.resume();
        }),
        new Promise((resolve, reject) =>
          write.end("changed", (error) =>
            error ? reject(error) : resolve(null),
          ),
        ),
      ]);
      return {
        values,
        errors,
        otherRead: fs.readFileSync("/tmp/lifetime-read", "utf8"),
        otherWrite: fs.readFileSync("/tmp/lifetime-write", "utf8"),
      };
    } finally {
      read.destroy();
      write.destroy();
      held = undefined;
    }
  };
}
