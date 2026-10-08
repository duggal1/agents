import {
  ArchiveIcon as Archive,
  BellIcon as Bell,
  BellDotIcon as BellDot,
  CheckIcon as Check,
  CopyIcon as Copy,
  EraserIcon as Eraser,
  Folder01Icon as Folder,
  FolderPlusIcon as FolderPlus,
  PencilIcon as Pencil,
  PinIcon as Pin,
  Delete02Icon as Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLingui } from "@lingui/react/macro";
import type { Bot, BotSection } from "@sapphire/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@sapphire/ui-web";

export type ContextMenuPosition = { x: number; y: number };

type ChatMenuTarget = Pick<Bot, "name" | "pinned" | "sectionId" | "unread">;

export function BotContextMenu({
  bot,
  position,
  onClose,
  onTogglePinned,
  sections,
  onMoveToSection,
  onCreateSection,
  onRenameSection,
  onToggleUnread,
  onEdit,
  onDuplicate,
  onClear,
  onArchive,
  onDelete,
}: {
  bot: ChatMenuTarget;
  position: ContextMenuPosition;
  onClose: () => void;
  onTogglePinned: () => void;
  sections: BotSection[];
  onMoveToSection: (sectionId: string | null) => void;
  onCreateSection: () => void;
  onRenameSection?: (sectionId: string) => void;
  onToggleUnread: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Invisible anchor at the pointer position; the menu itself carries the accessible name. */}
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="fixed size-0 p-0 opacity-0"
            style={{ left: position.x, top: position.y }}
          />
        }
      />
      <DropdownMenuContent
        aria-label={t`Actions for ${bot.name}`}
        align="start"
        sideOffset={0}
        className="max-h-[min(420px,calc(100vh-16px))] w-[264px] overflow-y-auto"
      >
        <DropdownMenuItem onClick={onTogglePinned}>
          <HugeiconsIcon icon={Pin} />
          {bot.pinned ? t`Unpin` : t`Pin`}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <HugeiconsIcon icon={Folder} />
            {t`Move to`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[min(420px,calc(100vh-16px))] min-w-[180px] overflow-y-auto">
            {sections.map((section) => (
              <DropdownMenuItem key={section.id} onClick={() => onMoveToSection(section.id)}>
                <HugeiconsIcon icon={Folder} />
                <span dir="auto">{section.name}</span>
                {bot.sectionId === section.id ? (
                  <HugeiconsIcon icon={Check} className="ms-auto" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => onMoveToSection(null)}>
              <HugeiconsIcon icon={Folder} />
              {t`Unassigned`}
              {bot.sectionId === null ? <HugeiconsIcon icon={Check} className="ms-auto" /> : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCreateSection}>
              <HugeiconsIcon icon={FolderPlus} />
              {t`New section`}
            </DropdownMenuItem>
            {bot.sectionId && onRenameSection ? (
              <DropdownMenuItem onClick={() => onRenameSection(bot.sectionId!)}>
                <HugeiconsIcon icon={Pencil} />
                {t`Rename section`}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={onToggleUnread}>
          {bot.unread ? <HugeiconsIcon icon={BellDot} /> : <HugeiconsIcon icon={Bell} />}
          {bot.unread ? t`Mark as Read` : t`Mark as Unread`}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onEdit}>
          <HugeiconsIcon icon={Pencil} />
          {t`Edit Profile`}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <HugeiconsIcon icon={Copy} />
          {t`Duplicate`}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClear}>
          <HugeiconsIcon icon={Eraser} />
          {t`Clear conversation`}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onArchive}>
          <HugeiconsIcon icon={Archive} />
          {t`Archive`}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <HugeiconsIcon icon={Trash2} />
          {t`Delete`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
