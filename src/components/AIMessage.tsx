import type { MessageResponse, ToolApprovalCallbacks } from "@/types/message";
import { Bot } from "lucide-react";
import Image from "next/image";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { getMessageContent, hasToolCalls, getToolCalls } from "@/services/messageUtils";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { useUISettings } from "@/contexts/UISettingsContext";
import MDEditor from "@uiw/react-md-editor";

const AGENT_AVATARS: Record<string, string> = {
  supervisor: "/avatars/supervisor.png",
  calendar: "/avatars/calendar.png",
  general: "/avatars/general.png",
  family: "/avatars/family.png",
  reminder: "/avatars/reminder.png",
  recipe: "/avatars/recipe.png",
  shopping: "/avatars/shopping.png",
};

interface AIMessageProps {
  message: MessageResponse;
  approvalCallbacks?: ToolApprovalCallbacks;
  showApprovalButtons?: boolean;
}

export const AIMessage = ({
  message,
  approvalCallbacks,
  showApprovalButtons = false,
}: AIMessageProps) => {
  const messageContent = getMessageContent(message);
  const hasTools = hasToolCalls(message);
  const toolCalls = getToolCalls(message);
  const { hideToolMessages } = useUISettings();

  // If tool messages are hidden and there's no text content, don't render anything
  const shouldShowTools = hasTools && !hideToolMessages;
  const hasVisibleContent = messageContent || shouldShowTools;

  if (!hasVisibleContent) {
    return null;
  }

  const avatarSrc = message.agentName ? AGENT_AVATARS[message.agentName] : undefined;

  return (
    <div className="flex gap-3">
      <div className="bg-primary/10 relative h-10 w-10 shrink-0 self-start overflow-hidden rounded-full">
        {avatarSrc ? (
          <Image
            src={avatarSrc}
            alt={message.agentName ?? "agent"}
            fill
            sizes="40px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Bot className="text-primary h-5 w-5" />
          </div>
        )}
      </div>
      <div className="max-w-[80%] space-y-3">
        {messageContent && (
          <div
            className={cn(
              "rounded-2xl px-4 py-2",
              "bg-gray-200/30 text-gray-800",
              "backdrop-blur-sm supports-backdrop-filter:bg-gray-200/30",
            )}
          >
            <div
              data-color-mode="light"
              className="[[&_hr]:my-1! [&_hr]:h-px [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-gray-300 [&_li]:my-1 [&_ol]:ml-6 [&_ol]:list-decimal [&_ul]:ml-6 [&_ul]:list-disc"
            >
              <MDEditor.Markdown
                source={messageContent}
                style={{
                  backgroundColor: "transparent",
                  color: "inherit",
                  padding: 0,
                  fontSize: "1rem",
                }}
                rehypePlugins={[rehypeKatex]}
              />
            </div>
          </div>
        )}

        {shouldShowTools && (
          <div className="space-y-2">
            <ToolCallDisplay
              toolCalls={toolCalls}
              approvalCallbacks={approvalCallbacks}
              showApprovalButtons={showApprovalButtons}
            />
          </div>
        )}
      </div>
    </div>
  );
};
