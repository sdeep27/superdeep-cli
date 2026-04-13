#!/usr/bin/env node

import { render } from "ink";
import { loadKeysIntoEnv } from "./config.js";
import { App } from "./app.js";

// Load any saved API keys into environment for pi-ai
loadKeysIntoEnv();

const { waitUntilExit } = render(<App />);
await waitUntilExit();
