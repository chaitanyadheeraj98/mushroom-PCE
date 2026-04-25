/graphify                          # run on current directory
/graphify ./raw                    # run on a specific folder
/graphify ./raw --mode deep        # more aggressive INFERRED edge extraction
/graphify ./raw --update           # re-extract only changed files, merge into existing graph
/graphify ./raw --directed          # build directed graph (preserves edge direction: source→target)
/graphify ./raw --cluster-only     # rerun clustering on existing graph, no re-extraction
/graphify ./raw --no-viz           # skip HTML, just produce report + JSON
/graphify ./raw --obsidian                          # also generate Obsidian vault (opt-in)
/graphify ./raw --obsidian --obsidian-dir ~/vaults/myproject  # write vault to a specific directory

/graphify add https://arxiv.org/abs/1706.03762        # fetch a paper, save, update graph
/graphify add https://x.com/karpathy/status/...       # fetch a tweet
/graphify add <video-url>                              # download audio, transcribe, add to graph
/graphify add https://... --author "Name"             # tag the original author
/graphify add https://... --contributor "Name"        # tag who added it to the corpus

/graphify query "what connects attention to the optimizer?"
/graphify query "what connects attention to the optimizer?" --dfs   # trace a specific path
/graphify query "what connects attention to the optimizer?" --budget 1500  # cap at N tokens
/graphify path "DigestAuth" "Response"
/graphify explain "SwinTransformer"

/graphify ./raw --watch            # auto-sync graph as files change (code: instant, docs: notifies you)
/graphify ./raw --wiki             # build agent-crawlable wiki (index.md + article per community)
/graphify ./raw --svg              # export graph.svg
/graphify ./raw --graphml          # export graph.graphml (Gephi, yEd)
/graphify ./raw --neo4j            # generate cypher.txt for Neo4j
/graphify ./raw --neo4j-push bolt://localhost:7687    # push directly to a running Neo4j instance
/graphify ./raw --mcp              # start MCP stdio server

# git hooks - platform-agnostic, rebuild graph on commit and branch switch
graphify hook install
graphify hook uninstall
graphify hook status

# always-on assistant instructions - platform-specific
graphify claude install            # CLAUDE.md + PreToolUse hook (Claude Code)
graphify claude uninstall
graphify codex install             # AGENTS.md + PreToolUse hook in .codex/hooks.json (Codex)
graphify opencode install          # AGENTS.md + tool.execute.before plugin (OpenCode)
graphify cursor install            # .cursor/rules/graphify.mdc (Cursor)
graphify cursor uninstall
graphify gemini install            # GEMINI.md + BeforeTool hook (Gemini CLI)
graphify gemini uninstall
graphify copilot install           # skill file (GitHub Copilot CLI)
graphify copilot uninstall
graphify aider install             # AGENTS.md (Aider)
graphify aider uninstall
graphify claw install              # AGENTS.md (OpenClaw)
graphify droid install             # AGENTS.md (Factory Droid)
graphify trae install              # AGENTS.md (Trae)
graphify trae uninstall
graphify trae-cn install           # AGENTS.md (Trae CN)
graphify trae-cn uninstall
graphify hermes install             # AGENTS.md + ~/.hermes/skills/ (Hermes)
graphify hermes uninstall
graphify kiro install               # .kiro/skills/ + .kiro/steering/graphify.md (Kiro IDE/CLI)
graphify kiro uninstall
graphify antigravity install       # .agent/rules + .agent/workflows (Google Antigravity)
graphify antigravity uninstall

# query and navigate the graph directly from the terminal (no AI assistant needed)
graphify query "what connects attention to the optimizer?"
graphify query "show the auth flow" --dfs
graphify query "what is CfgNode?" --budget 500
graphify query "..." --graph path/to/graph.json
graphify path "DigestAuth" "Response"       # shortest path between two nodes
graphify explain "SwinTransformer"           # plain-language explanation of a node

# add content and update the graph from the terminal
graphify add https://arxiv.org/abs/1706.03762          # fetch paper, save to ./raw, update graph
graphify add https://... --author "Name" --contributor "Name"

# incremental update and maintenance
graphify watch ./src                         # auto-rebuild on code changes
graphify update ./src                        # re-extract code files, no LLM needed
graphify cluster-only ./my-project           # rerun clustering on existing graph.json