import type {
  MessageResponse,
  BasicMessageData,
  FileAttachment,
  ImageUrlContentItem,
  TextContentItem,
} from "@/types/message";
import { FileText, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMessageContent } from "@/services/messageUtils";
import { useUISettings } from "@/contexts/UISettingsContext";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Deterministic color from name so each member always gets the same color
const AVATAR_COLORS = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-rose-400",
  "bg-amber-400",
  "bg-cyan-400",
  "bg-pink-400",
  "bg-teal-400",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface HumanMessageProps {
  message: MessageResponse;
}

type ContentItem = ImageUrlContentItem | TextContentItem | { type: string };

export const HumanMessage = ({ message }: HumanMessageProps) => {
  const data = message.data as BasicMessageData;
  const { caller } = useUISettings();
  const displayName = caller?.callerName ?? "Tú";
  const initials = getInitials(displayName);
  // Use the member's configured color if available, otherwise fall back to deterministic hash color
  const bgColor = caller?.callerColor ?? avatarColor(displayName);
  const attachments = [...(data.attachments || [])];

  // Extract attachments from content array (for messages loaded from checkpoint)
  if (message.data?.content && Array.isArray(message.data.content)) {
    const contentAttachments = (message.data.content as ContentItem[])
      .filter(
        (item): item is ImageUrlContentItem | TextContentItem =>
          // Images/PDFs with image_url
          (item.type === "image_url" && "image_url" in item && !!item.image_url) ||
          // Text files with file_metadata
          (item.type === "text" && "file_metadata" in item && !!item.file_metadata),
      )
      .map((item) => {
        if (item.file_metadata) {
          return item.file_metadata;
        }
        return null;
      })
      .filter((att): att is FileAttachment => att !== null);
    attachments.push(...contentAttachments);
  }

  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2",
            "bg-gray-300/50 text-gray-800",
            "backdrop-blur-sm supports-backdrop-filter:bg-gray-300/50",
          )}
        >
          {/* File Attachments */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.key}
                  className="flex items-center gap-2 rounded-md bg-gray-400/30 px-2 py-1 text-xs"
                >
                  {attachment.type.startsWith("image/") ? (
                    <>
                      <ImageIcon className="h-3.5 w-3.5" />
                      <img
                        src={attachment.url}
                        alt={attachment.name}
                        className="my-0 h-20 w-20 rounded object-cover"
                      />
                    </>
                  ) : (
                    <>
                      <FileText className="h-3.5 w-3.5" />
                      <a
                        href={attachment.url}
                        download={attachment.name}
                        className="max-w-[150px] truncate hover:underline"
                      >
                        {attachment.name}
                      </a>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Message Text */}
          <div className="prose dark:prose-invert max-w-none">
            <p className="my-0">{getMessageContent(message)}</p>
          </div>
        </div>
      </div>
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white",
          // If color is a hex value, use inline style; if it's a Tailwind class, use className
          !bgColor?.startsWith("#") && bgColor,
        )}
        style={bgColor?.startsWith("#") ? { backgroundColor: bgColor } : undefined}
        title={displayName}
      >
        <span className="text-sm font-semibold">{initials}</span>
      </div>
    </div>
  );
};
