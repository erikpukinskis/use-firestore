import * as HomePage from "./HomePage.docs"
import { DocsApp } from "codedocs"
import React from "react"
import { render } from "react-dom"

render(
  <DocsApp icon="fire" logo="Firestore Hooks" docs={[HomePage]} />,
  document.getElementById("root")
)
