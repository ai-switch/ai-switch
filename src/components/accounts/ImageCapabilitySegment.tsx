import { ModalityAccessPanel } from "./ModalityAccessPanel";

/** Compatibility wrapper; access information no longer launches Image Studio. */
export function ImageCapabilitySegment(_props: {
  imageGenerationEnabled: boolean;
  onOpenImageStudio?: () => void;
}) {
  return <ModalityAccessPanel modality="image" />;
}
