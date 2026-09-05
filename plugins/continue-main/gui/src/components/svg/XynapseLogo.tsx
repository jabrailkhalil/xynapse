interface XynapseLogoProps {
  height?: number;
  width?: number;
}

export default function XynapseLogo({
  height = 75,
}: XynapseLogoProps) {
  const mediaUrl = (window as any).vscMediaUrl || "";
  const logoUrl = mediaUrl + "/xyanpse_logo_new.jpg";

  return (
    <img
      src={logoUrl}
      alt="Xynapse"
      style={{
        maxHeight: height,
        width: "auto",
        display: "block",
        margin: "0 auto",
        objectFit: "contain",
        borderRadius: 8,
      }}
    />
  );
}
