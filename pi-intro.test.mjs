import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Run the real extension with small Pi and terminal adapters.
const source = stripTypeScriptTypes(
	readFileSync(new URL("./pi-intro.ts", import.meta.url), "utf8"),
).replace(/^import[\s\S]*?from "[^"]+";\s*/gm, "")
	.replace("export default function", "function install");

function setup(mode = "tui") {
	const handlers = {};
	const calls = [];
	let header;
	let renders = 0;
	const theme = { fg: (_color, value) => value, getColorMode: () => "truecolor" };
	const pi = {
		on: (name, handler) => { handlers[name] = handler; },
		registerCommand() {},
		exec: (command) => new Promise((resolve, reject) => {
			calls.push({ command, resolve, reject });
		}),
		getSessionName: () => "",
		getCommands: () => [],
	};
	const ctx = {
		mode,
		cwd: "/project",
		ui: {
			setHeader(factory) {
				header = factory({ requestRender: () => { renders++; } }, theme);
			},
		},
	};
	runInNewContext(source + "\ninstall(pi);", {
		pi, VERSION: "test",
		isAppleTerminalSession: () => true,
		foregroundAnsi: () => "", backgroundAnsi: () => "", rgbColor: () => "",
		truncateToWidth: (text) => text,
		wrapTextWithAnsi: (text) => text.split("\n"),
	});
	return { calls, start: () => handlers.session_start({}, ctx),
		get header() { return header; }, get renders() { return renders; } };
}

test("loads both values before installing the header; expansion uses the cache", async () => {
	const app = setup();
	const started = app.start();
	assert.deepEqual(app.calls.map(({ command }) => command).sort(), ["git", "pi"]);
	assert.equal(app.header, undefined);
	app.calls.find(({ command }) => command === "git").resolve({ code: 0, stdout: "main\n" });
	await Promise.resolve();
	assert.equal(app.header, undefined);
	app.calls.find(({ command }) => command === "pi").resolve({
		code: 0, stdout: "User packages:\n  npm:example\n    /install/path\n",
	});
	await started;
	app.header.setExpanded(true);
	const rendered = app.header.render(100).join("\n");
	assert.match(rendered, /Git branch: main/);
	assert.match(rendered, /User: example/);
	assert.doesNotMatch(rendered, /Checking…|Loading…/);
	app.header.setExpanded(false);
	app.header.setExpanded(true);
	assert.equal(app.calls.length, 2);
	assert.equal(app.renders, 0);
});

for (const failure of ["exit", "throw"]) {
	test("shows final fallback values on " + failure, async () => {
		const app = setup();
		const started = app.start();
		for (const call of app.calls) {
			if (failure === "throw") call.reject(new Error("failed"));
			else call.resolve({ code: 1, stdout: "" });
		}
		await started;
		app.header.setExpanded(true);
		const rendered = app.header.render(100).join("\n");
		assert.match(rendered, /Git branch: Not available/);
		assert.match(rendered, /Could not load packages/);
		assert.doesNotMatch(rendered, /Checking…|Loading…/);
	});
}

test("does not run checks outside TUI mode", async () => {
	const app = setup("json");
	await app.start();
	assert.equal(app.calls.length, 0);
	assert.equal(app.header, undefined);
});
