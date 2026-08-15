/**
 * Shell completion scripts for the `dsh` command.
 *
 * The scripts are intentionally static: they complete the launcher-owned
 * subcommands and flags, while each profile's app owns its inner arguments.
 * @module @deepseek-ai/dsh/completion
 */

/** The launcher-owned subcommands, in declaration order. */
const COMMANDS = ['login', 'model', 'status', 'logout', 'doctor', 'provider', 'providers', 'plugin', 'web', 'exec', 'resume', 'completion', 'help']

/**
 * Print the completion script for one shell.
 * @param shell - `bash` or `zsh`.
 */
export function runCompletion(shell: string | undefined): void {
  if (shell === 'zsh') process.stdout.write(zshCompletion())
  else if (shell === undefined || shell === 'bash') process.stdout.write(bashCompletion())
  else throw new Error('completion supports bash or zsh')
}

/** @returns the bash completion function source. */
export function bashCompletion(): string {
  return `_dsh_completions() {
  local cur commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  commands="${COMMANDS.join(' ')}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
  fi
}
complete -F _dsh_completions dsh
`
}

/** @returns the zsh completion function source. */
export function zshCompletion(): string {
  return `#compdef dsh
_dsh() {
  local -a commands
  commands=(${COMMANDS.join(' ')})
  _describe 'command' commands
}
compdef _dsh dsh
`
}
