import "./styles.css";
import { add } from "./example.js";

const pluginName = __APLG_NAME_JSON__;
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The generated template is missing #app.");

const heading = document.createElement("h1");
heading.textContent = pluginName;
const description = document.createElement("p");
description.textContent = `A minimal APLG plugin is ready. 2 + 3 = ${add(2, 3)}.`;
app.replaceChildren(heading, description);
