import { DocsApp } from "codedocs"
import React from "react"
import { render } from "react-dom"
import * as HomePage from "./HomePage.docs"

render(
  <DocsApp icon="fire" logo="Firestore Hooks" docs={[HomePage]} />,
  document.getElementById("root")
)
