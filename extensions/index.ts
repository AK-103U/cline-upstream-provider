/**
 * pi package entry point.
 *
 * pi builds the extension label shown at startup and in `pi config` from the
 * file's path inside the package: for package installs it renders
 * `<package name>:<path>`, stripping an `extensions/` prefix and collapsing
 * `index` files to the bare package name. Keeping the implementation in the
 * custom `pi/` directory would therefore show up as
 * `@ak-103u/cline-upstream-provider:pi/cline-upstream-provider.ts`.
 *
 * This shim exists only to give pi the conventional `extensions/index.ts`
 * path, so the label collapses to `@ak-103u/cline-upstream-provider`, while
 * the repository keeps its `dsh/` + `pi/` symmetry.
 *
 * IMPORTANT: the `pi.extensions` manifest in package.json must list this file
 * only. Listing `../pi/cline-upstream-provider.ts` as well would load the
 * extension twice (duplicate event listeners and footer registration).
 */
export { default } from "../pi/cline-upstream-provider.ts";
