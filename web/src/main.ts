import "./styles/base.css";
import { startApp } from "./app";
import { getLocale } from "./core/i18n";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("Missing #app root element");
}

document.documentElement.lang = getLocale();
void startApp(root);
