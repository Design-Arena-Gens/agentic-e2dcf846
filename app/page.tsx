import dynamic from "next/dynamic";

const SourceManager = dynamic(() => import("@/components/SourceManager"), {
  ssr: false
});

export default function Page() {
  return <SourceManager />;
}
