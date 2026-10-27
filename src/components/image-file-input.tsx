import type { InputHTMLAttributes } from "react";
/** Shared native file control: browser picker and server validation remain unchanged. */
export function ImageFileInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "accept">,
) {
  return (
    <input
      {...props}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className={["image-file-input", props.className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
