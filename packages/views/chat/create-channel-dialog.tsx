"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useCreateChatChannel } from "@uniwork/core/chat";
import { useProjects } from "@uniwork/core/tasks";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { SelectedMemberChips } from "./selected-member-chips";
import {
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

type Visibility = "public" | "private";
const NO_PROJECT = "__none__";
const NAME_MAX = 80;

export function CreateChannelDialog({
  open,
  onOpenChange,
  workspaceId,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  currentUserId: string;
  onCreated?: (room: ChatRoomRecord) => void;
}) {
  const { t } = useTranslation();
  const createChannel = useCreateChatChannel(workspaceId);
  const { data: projectList } = useProjects(workspaceId);
  const projects = projectList?.projects ?? [];

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [projectId, setProjectId] = useState<string>("");
  const [memberQuery, setMemberQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);
  const [error, setError] = useState<string | null>(null);

  const excludeUserIds = useMemo(
    () => new Set(pendingMembers.map((member) => member.user_id)),
    [pendingMembers],
  );

  const { filteredMembers, hasOtherMembers, isLoading, workspaceEmailMatch } = useWorkspaceMemberPicker({
    workspaceId,
    currentUserId,
    open,
    query: memberQuery,
    searchSubmitted,
    excludeUserIds,
  });

  const resetForm = () => {
    setName("");
    setTopic("");
    setVisibility("public");
    setProjectId("");
    setMemberQuery("");
    setSearchSubmitted(false);
    setPendingMembers([]);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const addMember = (contact: ChatContact) => {
    if (contact.user_id === currentUserId) return;
    setPendingMembers((prev) =>
      prev.some((member) => member.user_id === contact.user_id) ? prev : [...prev, contact],
    );
    setMemberQuery("");
    setSearchSubmitted(false);
  };

  const removeMember = (userId: string) => {
    setPendingMembers((prev) => prev.filter((member) => member.user_id !== userId));
  };

  const submitMemberSearch = () => {
    setSearchSubmitted(true);
    if (workspaceEmailMatch) {
      addMember(memberToChatContact(workspaceEmailMatch));
    }
  };

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= NAME_MAX;

  const submit = () => {
    if (!nameValid || createChannel.isPending) return;
    setError(null);
    createChannel
      .mutateAsync({
        name: trimmedName,
        visibility,
        topic: topic.trim() || undefined,
        project_id: projectId || undefined,
        member_user_ids: pendingMembers.map((m) => m.user_id),
      })
      .then((room) => {
        if (!room?.id) {
          setError(t("chat.channel.create_failed"));
          return;
        }
        handleOpenChange(false);
        onCreated?.(room);
      })
      .catch((err: unknown) => {
        setError(apiErrorMessage(err) ?? t("chat.channel.create_failed"));
      });
  };

  const visibilityOptions: { value: Visibility; title: string; hint: string }[] = [
    {
      value: "public",
      title: t("chat.channel.visibility_public_title"),
      hint: t("chat.channel.visibility_public_hint"),
    },
    {
      value: "private",
      title: t("chat.channel.visibility_private_title"),
      hint: t("chat.channel.visibility_private_hint"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="lg">
        <FormDialogHeader
          title={t("chat.channel.create_title")}
          description={t("chat.channel.create_description")}
        />
        <FormDialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="channel-name" className="text-label font-medium">
              {t("chat.channel.name_label")}
            </Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                submit();
              }}
              placeholder={t("chat.channel.name_placeholder")}
              autoFocus
              maxLength={NAME_MAX}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-topic" className="text-label font-medium">
              {t("chat.channel.topic_label")}
            </Label>
            <Textarea
              id="channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("chat.channel.topic_placeholder")}
              className="min-h-16 resize-none"
              maxLength={280}
            />
          </div>

          <div className="space-y-2">
            <p id="channel-visibility-label" className="text-label font-medium text-foreground">
              {t("chat.channel.visibility_label")}
            </p>
            <RadioGroup
              aria-labelledby="channel-visibility-label"
              value={visibility}
              onValueChange={(value) => {
                if (value === "public" || value === "private") setVisibility(value);
              }}
              className="gap-2 sm:grid-cols-2"
            >
              {visibilityOptions.map((option) => (
                <Label
                  key={option.value}
                  htmlFor={`channel-vis-${option.value}`}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 font-normal transition-colors hover:bg-surface-hover has-[[data-checked]]:border-primary has-[[data-checked]]:bg-brand-subtle"
                >
                  <RadioGroupItem
                    value={option.value}
                    id={`channel-vis-${option.value}`}
                    aria-describedby={`channel-vis-${option.value}-hint`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-body font-medium text-foreground">{option.title}</span>
                    <span
                      id={`channel-vis-${option.value}-hint`}
                      className="block text-caption text-pretty text-muted-foreground"
                    >
                      {option.hint}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label id="channel-project-label" htmlFor="channel-project" className="text-label font-medium">
              {t("chat.channel.project_label")}
            </Label>
            <Select
              value={projectId || NO_PROJECT}
              onValueChange={(value) => setProjectId(!value || value === NO_PROJECT ? "" : value)}
              items={[
                { value: NO_PROJECT, label: t("chat.channel.project_none") },
                ...projects.map((project) => ({ value: project.id, label: project.title })),
              ]}
            >
              <SelectTrigger
                id="channel-project"
                aria-labelledby="channel-project-label channel-project"
                className="w-full"
              >
                <SelectValue placeholder={t("chat.channel.project_none")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>{t("chat.channel.project_none")}</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <WorkspaceMemberSearchField
              id="channel-member-search"
              label={t("chat.channel.members_label")}
              query={memberQuery}
              onQueryChange={(value) => {
                setMemberQuery(value);
                setSearchSubmitted(false);
              }}
              onSubmit={submitMemberSearch}
              placeholder={t("chat.member_search_placeholder")}
            />
            {pendingMembers.length > 0 ? (
              <SelectedMemberChips members={pendingMembers} onRemove={removeMember} />
            ) : null}
            <WorkspaceMemberPickerList
              members={filteredMembers}
              loading={isLoading}
              query={memberQuery}
              hasOtherMembers={hasOtherMembers}
              onPick={addMember}
            />
          </div>

          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => handleOpenChange(false)}
          submitLabel={t("chat.channel.create")}
          submittingLabel={t("chat.channel.creating")}
          submitting={createChannel.isPending}
          submitDisabled={!nameValid}
          onSubmit={submit}
          leading={!nameValid ? t("chat.channel.name_required") : undefined}
        />
      </FormDialogContent>
    </Dialog>
  );
}
