"use client";
// How detail levels work (DetailLevels.dc.html; R2-DL). The page explains the one control and
// shows it working on real sections: a member's targets and how their day is split.
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { useHousehold } from "./data";
import { MealsSection } from "./meals-section";
import { ErrorBlock, LoadingBlock, useSavedSections } from "./parts";
import { TargetsSection } from "./targets-section";
import { Avatar } from "../ui/avatar";
import { LinkButton } from "../ui/button";
import { Icon } from "../ui/icon";

const PRINCIPLES = [
  [
    "1 · You always see what the app does for you",
    "Automatic values are shown, not hidden, marked with a grey “auto” tag.",
  ],
  [
    "2 · Change one thing without changing modes",
    "Tap any auto value to set it yourself. It turns orange, and “Back to auto” puts it back.",
  ],
  [
    "3 · Nothing is lost by going back",
    "Going to a lower level asks whether to keep your changes working quietly or reset them.",
  ],
] as const;

export function DetailLevelsScreen() {
  const { data, error, loading, reload } = useHousehold();
  const { isSaved, markSaved } = useSavedSections();
  const member = data?.members.find((m) => m.isTargeted) ?? data?.members[0];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[34px]">One control for detail, everywhere</h1>
        <p className="m-0 max-w-[900px] text-ink-soft">
          Every section has the same Basic · Detailed · Expert switch in its corner. It changes only
          that section, for that person. Try it: switch levels, then tap an &ldquo;auto&rdquo; value
          to make it your own.
        </p>
      </div>
      <ul className="m-0 grid list-none gap-3.5 p-0 md:grid-cols-3">
        {PRINCIPLES.map(([title, text]) => (
          <li key={title} className="flex flex-col gap-1 rounded-2xl bg-card p-4 shadow-card">
            <span className="font-extrabold">{title}</span>
            <span className="text-sm text-ink-soft">{text}</span>
          </li>
        ))}
      </ul>
      {data === null ? (
        error === null || loading ? (
          <LoadingBlock label="Loading" />
        ) : (
          <ErrorBlock message={error} onRetry={() => void reload()} />
        )
      ) : member === undefined ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-5 shadow-card">
          <p className="m-0">
            Add the family first; then every section here works on their real settings.
          </p>
          <LinkButton href="/onboarding">Set up the household</LinkButton>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Avatar
              name={member.displayName}
              color={isAvatarColor(member.color) ? member.color : null}
              colorKey={member.id}
              size={44}
            />
            <h2 className="text-2xl">{member.displayName}&apos;s settings</h2>
          </div>
          <TargetsSection
            key={`t-${JSON.stringify(data.targets.filter((t) => t.memberId === member.id))}`}
            data={data}
            member={member}
            onChanged={reload}
            saved={isSaved(`targets:${member.id}`)}
            onSaved={() => {
              markSaved(`targets:${member.id}`);
            }}
          />
          <MealsSection
            data={data}
            member={member}
            onChanged={reload}
            title="How a rest day is split across meals"
          />
        </>
      )}
      <div className="flex items-center gap-3.5 rounded-2xl bg-agent p-4 text-on-agent sm:px-5">
        <Icon name="assistant" size={26} />
        <p className="m-0">
          Don&apos;t want to touch any of this? Say it to the assistant:{" "}
          <strong>
            &ldquo;give {member?.displayName ?? "someone"} a bigger lunch on rest days&rdquo;
          </strong>
          . It changes the right level for you and shows an Undo.
        </p>
      </div>
    </div>
  );
}
