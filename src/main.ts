import "./style.css";
import { mountApp } from "./ui";
const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
mountApp(root);
