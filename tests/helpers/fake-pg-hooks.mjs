// Resolver hook: the server under test imports `pg` and gets the fake.
const fake = new URL("./fake-pg.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "pg") return { url: fake, shortCircuit: true };
  return next(specifier, context);
}
