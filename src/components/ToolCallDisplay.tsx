import React, { useState } from "react";
import { ChevronDown, ChevronRight, Settings2Icon, Check, X } from "lucide-react";
import type { ToolCall, FunctionCall, ToolApprovalCallbacks } from "@/types/message";

interface ToolCallDisplayProps {
  toolCalls?: ToolCall[];
  functionCalls?: FunctionCall[];
  approvalCallbacks?: ToolApprovalCallbacks;
  showApprovalButtons?: boolean;
}

const formatArgs = (args: Record<string, unknown> | string) => {
  const argsToFormat = typeof args === "string" ? JSON.parse(args) : args;
  return (
    <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-sm">
      {JSON.stringify(argsToFormat, null, 2)}
    </pre>
  );
};

const ToolCallItem: React.FC<{
  name: string;
  args: Record<string, unknown>;
  id?: string;
  approvalCallbacks?: ToolApprovalCallbacks;
  showApprovalButtons?: boolean;
}> = ({ name, args, id, approvalCallbacks, showApprovalButtons }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [decision, setDecision] = useState<"allow" | "deny" | null>(null);

  const handleApprove = async (toolId: string) => {
    setIsLoading(true);
    setDecision("allow");
    await approvalCallbacks!.onApprove(toolId);
  };

  const handleDeny = async (toolId: string) => {
    setIsLoading(true);
    setDecision("deny");
    await approvalCallbacks!.onDeny(toolId);
  };

  return (
    <div className="rounded-r border-l-4 border-gray-200 bg-gray-200/30 p-3">
      <button
        className="-m-1 flex w-full cursor-pointer items-center gap-2 rounded p-1 text-left hover:bg-gray-200/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-600" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-600" />
        )}
        <Settings2Icon className="h-4 w-4 shrink-0 text-gray-600" />
        <span className="font-medium text-gray-800">{name}</span>
      </button>

      {isExpanded && (
        <div className="mt-2 ml-6">
          <div className="mb-1 text-sm font-medium text-gray-700">Arguments:</div>
          {formatArgs(args)}
        </div>
      )}

      {showApprovalButtons && id && approvalCallbacks && (
        <div className="mt-3 flex justify-end gap-2">
          {decision ? (
            <span
              className={`flex items-center gap-1 text-sm font-medium ${decision === "allow" ? "text-green-700" : "text-red-700"}`}
            >
              {isLoading ? (
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : decision === "allow" ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {decision === "allow" ? "Allowed" : "Denied"}
            </span>
          ) : (
            <>
              <button
                onClick={() => handleDeny(id)}
                disabled={isLoading}
                className="flex items-center gap-1 rounded border border-red-200 px-3 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Deny
              </button>
              <button
                onClick={() => handleApprove(id)}
                disabled={isLoading}
                className="flex items-center gap-1 rounded border border-green-200 px-3 py-1 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Allow
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCalls = [],
  functionCalls = [],
  approvalCallbacks,
  showApprovalButtons = false,
}) => {
  const hasToolCalls = toolCalls.length > 0;
  const hasFunctionCalls = functionCalls.length > 0;

  if (!hasToolCalls && !hasFunctionCalls) {
    return null;
  }

  return (
    <div className="space-y-2">
      {hasToolCalls && (
        <div className="space-y-2">
          {toolCalls.map((toolCall, index) => (
            <ToolCallItem
              key={toolCall.id || index}
              name={toolCall.name}
              args={toolCall.args}
              id={toolCall.id}
              approvalCallbacks={approvalCallbacks}
              showApprovalButtons={showApprovalButtons}
            />
          ))}
        </div>
      )}

      {hasFunctionCalls && (
        <div className="space-y-2">
          {functionCalls.map((functionCall, index) => (
            <ToolCallItem
              key={index}
              name={functionCall.name}
              args={functionCall.args}
              approvalCallbacks={approvalCallbacks}
              showApprovalButtons={showApprovalButtons}
            />
          ))}
        </div>
      )}
    </div>
  );
};
