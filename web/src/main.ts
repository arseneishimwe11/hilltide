import "./styles/base.css";
import { getLocale } from "./core/i18n";
import { siteConfig } from "./core/siteConfig";
import { renderPlaceholder } from "./ui/placeholder";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("Missing #app root element");
}

document.documentElement.lang = getLocale();
renderPlaceholder(root, siteConfig);
