/**
 * Show the Pi logo and version, with project and session details on expansion.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
	backgroundAnsi,
	foregroundAnsi,
	isAppleTerminalSession,
	rgbColor,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// Match the built-in header's logo and fixed brand colors.
function logoLines(theme: Theme): string[] {
	const mode = theme.getColorMode();
	const coral = foregroundAnsi(rgbColor(228, 138, 122), mode);
	const blue = foregroundAnsi(rgbColor(79, 142, 179), mode);
	const yellow = foregroundAnsi(rgbColor(234, 182, 93), mode);
	const blueBackground = backgroundAnsi(rgbColor(79, 142, 179), mode);
	const reset = "\x1b[0m";
	const version = theme.fg("dim", `v${VERSION}`);

	if (isAppleTerminalSession()) {
		return [`${coral}P${reset}${yellow}i${reset} ${version}`];
	}

	return [
		`${coral}${blueBackground}▀${reset}${coral}▀█${reset}  ${version}`,
		`${blue}█▀${reset} ${yellow}█${reset}`,
	];
}

// Keep package sources, but omit the resolved install paths from `pi list`.
function formatPackageListing(listing: string): string {
	const lines: string[] = [];
	let scope = "";
	let packages: string[] = [];

	function flush() {
		if (packages.length > 0) {
			packages.sort((a, b) => a.localeCompare(b));
			lines.push(`${scope ? `${scope}: ` : ""}${packages.join(", ")}`);
			packages = [];
		}
	}

	for (const line of listing.split(/\r?\n/)) {
		const heading = line.match(/^(User|Project) packages:$/);
		if (heading) {
			flush();
			scope = heading[1];
		} else if (/^ {2}\S/.test(line)) {
			packages.push(line.trim().replace(/^npm:/, ""));
		} else if (line.trim() && !/^\s/.test(line)) {
			flush();
			lines.push(line.trim());
		}
	}
	flush();
	return lines.join("\n") || "No installed packages";
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui") {
			ctx.ui.setHeader((tui, theme) => {
				let expanded = false;
				let branch = "Checking…";
				let disposed = false;
				let packageListing = "Loading…";
				let packagesLoading = false;

				async function refreshPackages() {
					if (packagesLoading || disposed) return;
					packagesLoading = true;
					try {
						const result = await pi.exec("pi", ["list"], {
							cwd: ctx.cwd,
							timeout: 10000,
						});
						packageListing =
							result.code === 0
								? formatPackageListing(result.stdout)
								: "Could not load packages (pi list failed)";
					} catch {
						packageListing = "Could not load packages (pi list failed)";
					} finally {
						packagesLoading = false;
						if (!disposed) tui.requestRender();
					}
				}

				async function refreshBranch() {
					try {
						const result = await pi.exec(
							"git",
							["rev-parse", "--abbrev-ref", "HEAD"],
							{ cwd: ctx.cwd, timeout: 2000 },
						);
						branch = result.code === 0 ? result.stdout.trim() : "Not available";
						if (branch === "HEAD") branch = "Detached HEAD";
					} catch {
						branch = "Not available";
					}
					if (!disposed) tui.requestRender();
				}

				return {
					setExpanded(value: boolean) {
						expanded = value;
						if (expanded) {
							void refreshBranch();
							void refreshPackages();
						}
					},
					render(width: number) {
						const lines = ["", ...logoLines(theme)];
						if (expanded) {
							lines.push(
								"",
								`${theme.fg("accent", "Project:")} ${ctx.cwd}`,
								`${theme.fg("accent", "Git branch:")} ${branch}`,
								`${theme.fg("accent", "Session:")} ${pi.getSessionName() || "Unnamed"}`,
							);

							const commands = pi.getCommands();
							for (const [title, source] of [
								["Skills", "skill"],
								["Prompts", "prompt"],
							] as const) {
								const names = commands
									.filter((command) => command.source === source)
									.map((command) =>
										source === "skill"
											? command.name.replace(/^skill:/, "")
											: `/${command.name}`,
									)
									.sort((a, b) => a.localeCompare(b));

								if (names.length === 0) continue;
								lines.push("", theme.fg("accent", `[${title}]`));
								for (const line of wrapTextWithAnsi(
									names.join(", "),
									Math.max(1, width - 3),
								)) {
									lines.push(theme.fg("dim", `  ${line}`));
								}
							}
							lines.push("", theme.fg("accent", "[Packages]"));
							for (const line of wrapTextWithAnsi(
								packageListing,
								Math.max(1, width - 3),
							)) {
								lines.push(theme.fg("dim", `  ${line}`));
							}
							lines.push(
								"",
								...wrapTextWithAnsi(
									theme.fg(
										"dim",
										"/name — name session · /tree — session tree · /hotkeys — keyboard shortcuts",
									),
									Math.max(1, width - 1),
								),
							);
						}
						return lines.map((line) => truncateToWidth(` ${line}`, width));
					},
					invalidate() {},
					dispose() {
						disposed = true;
					},
				};
			});
		}
	});

	pi.registerCommand("builtin-header", {
		description: "Restore built-in header with keybinding hints",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
