import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Shared Markdown presentation without importing the old application's entire chat module. */
export default function RichText({ children }: { children: string }) {
  return <div className="dt-prose"><Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
  }}>{children}</Markdown></div>;
}
