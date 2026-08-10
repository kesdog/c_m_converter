import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.querySelector("#root")).render(
  <ChakraProvider value={defaultSystem}>
    <App pageType={document.body.dataset.page || "currency"} />
  </ChakraProvider>,
);
