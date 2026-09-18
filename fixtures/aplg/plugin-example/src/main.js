import { analyzeText } from "./analyze-text.js";
import "./styles.css";

const input = document.querySelector("#text-input");
const characters = document.querySelector("#character-count");
const nonWhitespace = document.querySelector("#non-whitespace-count");
const lines = document.querySelector("#line-count");
const status = document.querySelector("#statistics-status");
const numberFormat = new Intl.NumberFormat("zh-CN");

function render() {
  const result = analyzeText(input.value);
  characters.textContent = numberFormat.format(result.characters);
  nonWhitespace.textContent = numberFormat.format(result.nonWhitespace);
  lines.textContent = numberFormat.format(result.lines);
  status.textContent = `${result.characters} 个字符，${result.nonWhitespace} 个非空白字符，${result.lines} 行。`;
}

input.addEventListener("input", render);
document.querySelector("#sample-button").addEventListener("click", () => {
  input.value = "Hello, AI Switch!\n你好，插件世界。🙂";
  render();
  input.focus();
});
document.querySelector("#clear-button").addEventListener("click", () => {
  input.value = "";
  render();
  input.focus();
});

render();
