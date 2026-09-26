import { Composition, registerRoot } from "remotion";
import { WorkflowFilm } from "./workflow-film";

function Root() {
  return <Composition id="WorkflowFilm" component={WorkflowFilm} width={960} height={640} fps={30} durationInFrames={210} />;
}

registerRoot(Root);
