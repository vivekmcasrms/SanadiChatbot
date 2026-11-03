import { memo, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  normalizeAnswer,
  splitAnswerBlocks,
  isBadgeFact,
  type FactItem,
  type FactTone,
} from "@/lib/format-answer";

const TONE_CARD: Record<FactTone, string> = {
  neutral: "border-border bg-card",
  success: "border-success/30 bg-success/5",
  warning: "border-warning/40 bg-warning/10",
  danger: "border-destructive/30 bg-destructive/5",
};

const TONE_BAR: Record<FactTone, string> = {
  neutral: "bg-primary/40",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

const TONE_BADGE: Record<FactTone, string> = {
  neutral: "border-border bg-muted text-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/15 text-warning-foreground",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

const TONE_ICON: Record<FactTone, typeof Info> = {
  neutral: Info,
  success: CheckCircle2,
  warning: Clock,
  danger: AlertTriangle,
};

function StatusBadge({ item }: { item: FactItem }) {
  const Icon = TONE_ICON[item.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        TONE_BADGE[item.tone],
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span dir="auto">{item.value}</span>
    </span>
  );
}

function FactsCard({ items, title, tone }: { items: FactItem[]; title?: string | undefined; tone: FactTone }) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={cn(
        "relative my-3 overflow-hidden rounded-xl border p-3 card-shadow first:mt-0 last:mb-0 sm:p-4",
        TONE_CARD[tone],
      )}
      dir="auto"
    >
      <span className={cn("absolute inset-y-0 start-0 w-1", TONE_BAR[tone])} aria-hidden />
      {title ? (
        <div className="mb-2.5 flex items-center gap-2 ps-1.5">
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "danger" && "text-destructive",
              tone === "neutral" && "text-primary",
            )}
            aria-hidden
          />
          <h4 className="text-sm font-semibold tracking-tight text-foreground">{title}</h4>
        </div>
      ) : null}
      <dl className="grid gap-x-8 gap-y-2 ps-1.5 sm:grid-cols-2">
        {items.map((item, i) => (
          <div
            key={`${item.label}-${i}`}
            className="flex flex-col gap-0.5 border-b border-border/40 pb-1.5 last:border-0 sm:[&:nth-last-child(-n+2)]:border-0"
          >
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </dt>
            <dd className="min-w-0 text-sm font-semibold text-foreground">
              {isBadgeFact(item) ? <StatusBadge item={item} /> : <span dir="auto">{item.value}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MarkdownBody({ children }: { children: string }) {
  return (
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-5 text-lg font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2.5 mt-5 text-base font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-3 text-sm leading-relaxed text-foreground last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 ms-4 list-disc space-y-1.5 text-sm text-foreground last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 ms-4 list-decimal space-y-1.5 text-sm text-foreground last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="ps-1 leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
          a: ({ href, children }) => {
            // Internal app links must stay in the same tab and use router
            // navigation — opening them in a new tab loses the preview session
            // and forces the student to sign in again.
            const isInternal = !!href && href.startsWith("/");
            return (
              <a
                href={href}
                {...(isInternal ? {} : { target: "_blank", rel: "noreferrer" })}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {children}
              </a>
            );
          },
          hr: () => <hr className="my-4 border-border" />,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-s-2 border-primary/30 bg-surface/60 ps-3 italic text-foreground/80 last:mb-0">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-2 text-foreground">{children}</td>
          ),
        }}
      >
        {children}
      </Markdown>
  );
}

function AssistantMarkdownImpl({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const normalized = normalizeAnswer(children);
  const blocks = splitAnswerBlocks(normalized);
  return (
    <div className={cn("assistant-markdown space-y-1", className)} dir="auto">
      {blocks.map((block, i) =>
        block.kind === "facts" ? (
          <FactsCard key={i} items={block.items} title={block.title} tone={block.tone} />
        ) : (
          <MarkdownBody key={i}>{block.content}</MarkdownBody>
        ),
      )}
    </div>
  );
}

export function UserMessageBubble({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Memoised: during token streaming only the last message changes, so already
 * completed messages must not re-parse their markdown on every token.
 */
export const AssistantMarkdown = memo(AssistantMarkdownImpl);
