import { Fragment, useEffect, useState } from 'react'
import { Check, Ellipsis } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { Environment } from '../../../../../shared/api-client/api-client-types'
import { ConfirmDeleteDialog } from './CollectionTreeDialogs'
import type { ApiClientEnvironmentActions } from './use-api-client-environment-actions'

type EnvironmentAction = 'activate' | 'rename' | 'duplicate' | 'export' | 'delete'

type EnvironmentListProps = {
  environments: readonly Environment[]
  activeEnvironmentId: string | null
  selectedEnvironmentId: string | null
  actions: ApiClientEnvironmentActions
  onOpen: (environmentId: string) => void
  /** A just-created environment that should start in rename mode. */
  renameRequestId?: string | null
  onExport?: (environmentId: string) => void
}

type MenuEntry = {
  action: EnvironmentAction
  label: string
  destructive?: boolean
  separatorBefore?: boolean
}

function menuEntries(isActive: boolean, canExport: boolean): MenuEntry[] {
  return [
    {
      action: 'activate',
      label: isActive
        ? translate('apiClient.environments.clearActive', 'Deactivate')
        : translate('apiClient.environments.setActive', 'Set active')
    },
    { action: 'rename', label: translate('apiClient.tree.rename', 'Rename') },
    { action: 'duplicate', label: translate('apiClient.tree.duplicate', 'Duplicate') },
    ...(canExport
      ? [{ action: 'export' as const, label: translate('apiClient.tree.export', 'Export…') }]
      : []),
    {
      action: 'delete',
      label: translate('apiClient.tree.delete', 'Delete'),
      destructive: true,
      separatorBefore: true
    }
  ]
}

export default function EnvironmentList({
  environments,
  activeEnvironmentId,
  selectedEnvironmentId,
  actions,
  onOpen,
  renameRequestId = null,
  onExport
}: EnvironmentListProps): React.JSX.Element {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Environment | null>(null)

  useEffect(() => {
    if (renameRequestId) {
      setRenamingId(renameRequestId)
    }
  }, [renameRequestId])

  const run = (environment: Environment, action: EnvironmentAction): void => {
    switch (action) {
      case 'activate':
        void actions.setActive(environment.id === activeEnvironmentId ? null : environment.id)
        break
      case 'rename':
        setRenamingId(environment.id)
        break
      case 'duplicate':
        void actions.duplicate(environment.id)
        break
      case 'export':
        onExport?.(environment.id)
        break
      case 'delete':
        setDeleting(environment)
        break
    }
  }

  return (
    <>
      <ul
        className="space-y-0.5"
        aria-label={translate('apiClient.environments.label', 'Environments')}
      >
        {environments.map((environment) => {
          const entries = menuEntries(environment.id === activeEnvironmentId, Boolean(onExport))
          return (
            <li key={environment.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    data-selected={environment.id === selectedEnvironmentId ? 'true' : undefined}
                    className="group flex h-7 items-center gap-1 rounded-md px-2 hover:bg-accent data-[selected=true]:bg-accent"
                  >
                    {renamingId === environment.id ? (
                      <Input
                        autoFocus
                        defaultValue={environment.name}
                        aria-label={translate(
                          'apiClient.environments.environmentName',
                          'Environment name'
                        )}
                        className="h-6"
                        onBlur={() => setRenamingId(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            const name = event.currentTarget.value.trim()
                            setRenamingId(null)
                            if (name && name !== environment.name) {
                              void actions.rename(environment.id, name)
                            }
                          } else if (event.key === 'Escape') {
                            setRenamingId(null)
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        onClick={() => onOpen(environment.id)}
                      >
                        {environment.id === activeEnvironmentId ? (
                          <Check
                            className="size-3.5 shrink-0"
                            aria-label={translate('apiClient.environments.active', 'Active')}
                          />
                        ) : (
                          <span className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate text-[13px]">{environment.name}</span>
                        <Badge variant="hostContext" className="ml-auto">
                          {environment.variables.length}
                        </Badge>
                      </button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        {/* Why a wrapper: Button owns its effects, so the hover reveal lives on a plain element. */}
                        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={translate('apiClient.tree.moreActions', 'More actions')}
                          >
                            <Ellipsis />
                          </Button>
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {entries.map((entry) => (
                          <Fragment key={entry.action}>
                            {entry.separatorBefore ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuItem
                              variant={entry.destructive ? 'destructive' : 'default'}
                              onSelect={() => run(environment, entry.action)}
                            >
                              {entry.label}
                            </DropdownMenuItem>
                          </Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {entries.map((entry) => (
                    <Fragment key={entry.action}>
                      {entry.separatorBefore ? <ContextMenuSeparator /> : null}
                      <ContextMenuItem
                        variant={entry.destructive ? 'destructive' : 'default'}
                        onSelect={() => run(environment, entry.action)}
                      >
                        {entry.label}
                      </ContextMenuItem>
                    </Fragment>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            </li>
          )
        })}
      </ul>
      {deleting ? (
        <ConfirmDeleteDialog
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting
            setDeleting(null)
            void actions.remove(target.id)
          }}
        />
      ) : null}
    </>
  )
}
