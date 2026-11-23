// Passed to node with --import so `pg` resolves to the test double.
import { register } from "node:module";

register("./fake-pg-hooks.mjs", import.meta.url);
