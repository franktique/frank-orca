import React, { useCallback, useMemo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { buildExplanationQuestionPrompt } from '../../../../../shared/agent-explanations/explanation-question-prompt'
import type { FollowUpQuestion } from '../../../../../shared/agent-explanations/explanation-types'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { NotesSendMenu, type NotesSendMenuScope } from '../NotesSendMenu'

type QuestionNote = { id?: string; itemId: string; body: string }

/** Questions on one explanation item: sent history, plus a composer that saves a draft on blur. */
export function ExplanationQuestionSection({
  workspaceId,
  itemId
}: {
  workspaceId: string
  itemId: string
}): React.JSX.Element | null {
  const explanation = useAppStore(
    (s) => s.explanationsByWorkspace[workspaceId]?.explanation ?? null
  )
  const draftKey = `${workspaceId}::${itemId}`
  const typedDraft = useAppStore((s) => s.explanationQuestionDrafts[draftKey])
  const groupId = useAppStore((s) => s.activeGroupIdByWorktree?.[workspaceId] ?? '')
  const setDraft = useAppStore((s) => s.setExplanationQuestionDraft)
  const upsert = useAppStore((s) => s.upsertExplanationQuestion)
  const markSent = useAppStore((s) => s.markExplanationQuestionsSent)
  const remove = useAppStore((s) => s.deleteExplanationQuestion)

  const questions = useMemo(
    () => (explanation?.questions ?? []).filter((question) => question.itemId === itemId),
    [explanation, itemId]
  )
  const sent = questions.filter((question) => question.state === 'sent')
  const savedDraft = questions.find((question) => question.state === 'draft')
  // Text shown in the box: what the user typed, else the saved draft, else nothing.
  const body = typedDraft ?? savedDraft?.body ?? ''
  const composing = typedDraft !== undefined || savedDraft !== undefined

  const saveDraft = useCallback(async (): Promise<FollowUpQuestion | null> => {
    const trimmed = body.trim()
    if (!trimmed) {
      return null
    }
    if (savedDraft && savedDraft.body === trimmed) {
      return savedDraft
    }
    const result = await upsert(workspaceId, { id: savedDraft?.id, itemId, body: trimmed })
    return result.ok ? (result.question ?? null) : null
  }, [body, itemId, savedDraft, upsert, workspaceId])

  const scopes = useMemo<NotesSendMenuScope<QuestionNote>[]>(() => {
    const trimmed = body.trim()
    const prompt = explanation
      ? (buildExplanationQuestionPrompt(explanation, { itemId, body: trimmed }) ?? '')
      : ''
    return [
      {
        id: 'question',
        label: translate(
          'auto.components.right.sidebar.explanations.questions.scope',
          'This question'
        ),
        notes: trimmed && prompt ? [{ id: savedDraft?.id, itemId, body: trimmed }] : [],
        prompt
      }
    ]
  }, [body, explanation, itemId, savedDraft?.id])

  const handleDelivered = useCallback(
    async (_notes: readonly QuestionNote[], target?: { paneKey?: string; label: string }) => {
      const question = await saveDraft()
      if (!question) {
        return
      }
      const result = await markSent(workspaceId, [question.id], {
        paneKey: target?.paneKey,
        label:
          target?.label ??
          translate('auto.components.right.sidebar.explanations.questions.newAgent', 'a new agent')
      })
      if (result.ok) {
        setDraft(workspaceId, itemId, null)
      }
    },
    [itemId, markSent, saveDraft, setDraft, workspaceId]
  )

  if (!explanation) {
    return null
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="explanation-questions">
      {sent.map((question) => (
        <div
          key={question.id}
          data-testid="explanation-question-sent"
          className="flex items-start gap-1 rounded-md bg-muted/50 px-2 py-1"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="whitespace-pre-wrap break-words text-[13px]">{question.body}</span>
            <span className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.explanations.questions.sentTo',
                'Sent to {{target}} · {{time}}',
                {
                  target: question.sentTo?.label ?? '',
                  time: question.sentAt ? formatRelativeTime(question.sentAt) : ''
                }
              )}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate(
              'auto.components.right.sidebar.explanations.questions.askAgain',
              'Edit and ask again'
            )}
            onClick={() => setDraft(workspaceId, itemId, question.body)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate(
              'auto.components.right.sidebar.explanations.questions.delete',
              'Delete question'
            )}
            onClick={() => void remove(workspaceId, question.id)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      {composing ? (
        <div className="flex flex-col gap-1">
          <Textarea
            data-testid="explanation-question-input"
            className="min-h-14"
            value={body}
            placeholder={translate(
              'auto.components.right.sidebar.explanations.questions.placeholder',
              'Ask the agent about this change'
            )}
            onChange={(event) => setDraft(workspaceId, itemId, event.target.value)}
            onBlur={() => void saveDraft()}
          />
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setDraft(workspaceId, itemId, null)
                if (savedDraft) {
                  void remove(workspaceId, savedDraft.id)
                }
              }}
            >
              {translate('auto.components.right.sidebar.explanations.questions.discard', 'Discard')}
            </Button>
            <NotesSendMenu<QuestionNote>
              worktreeId={workspaceId}
              groupId={groupId}
              modeIdParts={['explanation-question', workspaceId, explanation.id, itemId]}
              scopes={scopes}
              source="diff-notes"
              preferredTargetPaneKey={explanation.producer.paneKey}
              triggerClassName="h-6 gap-1 px-2 text-xs"
              actionLabel={translate(
                'auto.components.right.sidebar.explanations.questions.send',
                'Send'
              )}
              disabledTooltip={translate(
                'auto.components.right.sidebar.explanations.questions.writeFirst',
                'Write a question first'
              )}
              onDelivered={(notes, target) => void handleDelivered(notes, target)}
            />
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          data-testid="explanation-ask"
          onClick={() => setDraft(workspaceId, itemId, '')}
        >
          {translate('auto.components.right.sidebar.explanations.questions.ask', 'Ask a question')}
        </Button>
      )}
    </div>
  )
}
