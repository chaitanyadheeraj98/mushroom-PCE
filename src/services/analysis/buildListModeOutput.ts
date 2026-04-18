import * as ts from 'typescript';
import * as vscode from 'vscode';

type ClassMemberGroup = {
	staticProperties: string[];
	readonlyProperties: string[];
	mutableProperties: string[];
	staticMethods: string[];
	constructors: string[];
	instanceMethods: string[];
};

type ClassInfo = {
	name: string;
	members: ClassMemberGroup;
};

type TypeScriptConcepts = {
	imports: string[];
	exports: string[];
	classes: ClassInfo[];
	functions: string[];
	internalFunctions: string[];
	parameters: string[];
	returnTypes: string[];
	variables: string[];
	objects: string[];
	messagePayloads: string[];
	controlStructures: string[];
	operators: string[];
	asyncConcepts: string[];
	eventConcepts: string[];
	designPatterns: string[];
	typeSystem: string[];
	dataFlow: string[];
	uiSystem: string[];
	architecture: string[];
	errorHandling: string[];
	security: string[];
	resourceManagement: string[];
	advancedConcepts: string[];
};

const EMPTY = '- -';
const MESSAGE_PROPS = ['nodeId', 'label', 'scope', 'dependencyMode', 'graph', 'result', 'error', 'fromNodeId', 'toNodeId', 'text'];

export async function buildListModeOutput(document: vscode.TextDocument): Promise<string> {
	if (isTypeScriptLike(document.languageId)) {
		return buildTypeScriptConceptOutput(document);
	}

	return buildGenericConceptOutput(document);
}

function buildTypeScriptConceptOutput(document: vscode.TextDocument): string {
	const code = document.getText();
	const sourceFile = ts.createSourceFile(
		document.fileName || inferFileName(document.languageId),
		code,
		ts.ScriptTarget.Latest,
		true,
		inferScriptKind(document.languageId)
	);
	const strippedCode = stripStringLikeLiterals(code, sourceFile);
	const concepts = collectTypeScriptConcepts(sourceFile, code, strippedCode);
	return renderConcepts(concepts, document);
}

function collectTypeScriptConcepts(sourceFile: ts.SourceFile, code: string, strippedCode: string): TypeScriptConcepts {
	const concepts = createConcepts();
	const typeUse = collectTypeIdentifierUses(sourceFile);
	const valueUse = collectValueIdentifierUses(sourceFile);
	const exportedNames = new Set<string>();
	const messageTypes = new Map<string, Set<string>>();
	const eventCalls = new Set<string>();
	const callbackPropertyNames = new Set<string>();
	const typeImports = new Set<string>();
	const unionTypes = new Set<string>();
	const optionalMembers = new Set<string>();
	const genericTypes = new Set<string>();
	const localVariableNames = new Set<string>();
	const returnTypeTexts = new Set<string>();
	const classNames = new Set<string>();

	const addParameter = (param: ts.ParameterDeclaration): void => {
		const name = param.name.getText(sourceFile);
		const typeText = param.type ? cleanTypeText(param.type.getText(sourceFile)) : 'unknown';
		const optional = param.questionToken ? '?' : '';
		addUnique(concepts.parameters, `${name}${optional}: ${typeText}`);
		if (param.questionToken) {
			optionalMembers.add(`${name}${optional}: ${typeText}`);
		}
		if (param.type) {
			collectTypeSystemFromTypeNode(param.type, unionTypes, genericTypes);
		}
	};

	const addReturnType = (typeNode: ts.TypeNode | undefined): void => {
		if (!typeNode) {
			return;
		}
		const typeText = cleanTypeText(typeNode.getText(sourceFile));
		if (typeText) {
			returnTypeTexts.add(typeText);
			collectTypeSystemFromTypeNode(typeNode, unionTypes, genericTypes);
		}
	};

	const scanFunctionSignature = (
		node:
			| ts.FunctionDeclaration
			| ts.MethodDeclaration
			| ts.ConstructorDeclaration
			| ts.ArrowFunction
			| ts.FunctionExpression
			| ts.FunctionTypeNode
	): void => {
		node.parameters.forEach(addParameter);
		if (!ts.isConstructorDeclaration(node)) {
			addReturnType(node.type);
		}
	};

	const scanTypeNode = (node: ts.TypeNode | undefined): void => {
		if (!node) {
			return;
		}
		collectTypeSystemFromTypeNode(node, unionTypes, genericTypes);
		const visit = (child: ts.Node): void => {
			if (ts.isFunctionTypeNode(child)) {
				scanFunctionSignature(child);
			}
			ts.forEachChild(child, visit);
		};
		visit(node);
	};

	const scanBody = (node: ts.Node | undefined, scopeLabel: string): void => {
		if (!node) {
			return;
		}

		const visit = (child: ts.Node): void => {
			if (ts.isVariableDeclaration(child)) {
				const names = getBindingNames(child.name);
				for (const name of names) {
					localVariableNames.add(name);
				}
				if (child.type) {
					scanTypeNode(child.type);
				}
				if (
					ts.isIdentifier(child.name) &&
					child.initializer &&
					(ts.isArrowFunction(child.initializer) || ts.isFunctionExpression(child.initializer))
				) {
					const signature = formatFunctionLike(child.name.text, child.initializer, sourceFile);
					addUnique(concepts.internalFunctions, `Inside ${scopeLabel}: ${signature}`);
					scanFunctionSignature(child.initializer);
				}
			}

			if (ts.isCatchClause(child) && child.variableDeclaration) {
				for (const name of getBindingNames(child.variableDeclaration.name)) {
					localVariableNames.add(name);
				}
			}

			if (ts.isFunctionDeclaration(child) && child.name && child.parent !== sourceFile) {
				addUnique(concepts.internalFunctions, `Inside ${scopeLabel}: ${formatFunctionLike(child.name.text, child, sourceFile)}`);
				scanFunctionSignature(child);
			}

			if (ts.isCallExpression(child)) {
				const callName = getCallName(child.expression);
				if (callName) {
					if (/\.on[A-Z]/.test(callName) || callName.includes('onDid')) {
						eventCalls.add(callName);
					}
					if (callName.endsWith('.postMessage') || callName === 'postMessage') {
						addUnique(concepts.dataFlow, '`postMessage(...)` synchronizes extension state back into the webview UI');
					}
					if (callName === 'vscode.window.showInformationMessage') {
						addUnique(concepts.errorHandling, '`vscode.window.showInformationMessage` provides user feedback');
					}
					if (callName === 'CircuitDetailsPanel.syncGraph') {
						addUnique(concepts.dataFlow, '`CircuitDetailsPanel.syncGraph(graph)` keeps the details panel aligned with graph state');
					}
				}
			}

			if (ts.isBinaryExpression(child)) {
				if (child.operatorToken.kind === ts.SyntaxKind.EqualsToken && child.left.getText(sourceFile).startsWith('this.')) {
					addUnique(concepts.dataFlow, `State mutation: \`${child.left.getText(sourceFile)} = ${child.right.getText(sourceFile)}\``);
				}
				collectMessageTypeCheck(child, sourceFile, messageTypes);
			}

			if (ts.isObjectLiteralExpression(child)) {
				collectMessagePayload(child, sourceFile, concepts.messagePayloads);
			}

			if (ts.isReturnStatement(child)) {
				addUnique(concepts.controlStructures, '`return` / early returns');
			}

			ts.forEachChild(child, visit);
		};

		ts.forEachChild(node, visit);
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			collectImport(statement, sourceFile, typeUse, valueUse, concepts.imports, typeImports);
			continue;
		}

		if (ts.isClassDeclaration(statement) && statement.name) {
			const className = statement.name.text;
			classNames.add(className);
			if (hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword)) {
				exportedNames.add(className);
			}
			const classInfo = collectClass(statement, sourceFile, scanFunctionSignature, scanTypeNode, scanBody, optionalMembers, callbackPropertyNames);
			concepts.classes.push(classInfo);
			continue;
		}

		if (ts.isFunctionDeclaration(statement) && statement.name) {
			if (hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword)) {
				exportedNames.add(statement.name.text);
			}
			addUnique(concepts.functions, formatFunctionLike(statement.name.text, statement, sourceFile));
			scanFunctionSignature(statement);
			scanBody(statement.body, statement.name.text);
			continue;
		}

		if (ts.isVariableStatement(statement)) {
			if (hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword)) {
				for (const declaration of statement.declarationList.declarations) {
					for (const name of getBindingNames(declaration.name)) {
						exportedNames.add(name);
					}
				}
			}
			scanBody(statement, 'top-level');
			continue;
		}

		collectExportNames(statement, sourceFile, exportedNames);
	}

	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) && !ts.isClassDeclaration(statement) && !ts.isFunctionDeclaration(statement)) {
			scanBody(statement, 'top-level');
		}
	}

	renderExports(exportedNames, classNames, concepts.exports);
	renderVariables(localVariableNames, concepts.variables);
	renderReturnTypes(returnTypeTexts, concepts.returnTypes);
	renderObjects(typeImports, concepts, code);
	renderMessageTypeChecks(messageTypes, concepts.messagePayloads);
	renderControlStructures(sourceFile, concepts.controlStructures);
	renderOperators(sourceFile, strippedCode, concepts.operators);
	renderAsyncConcepts(sourceFile, returnTypeTexts, eventCalls, concepts.asyncConcepts);
	renderEventConcepts(eventCalls, concepts.eventConcepts, code);
	renderDesignPatterns(concepts, callbackPropertyNames, eventCalls, messageTypes);
	renderTypeSystem(typeImports, unionTypes, optionalMembers, genericTypes, concepts.typeSystem);
	renderUiSystem(code, concepts.uiSystem);
	renderArchitecture(code, concepts.architecture);
	renderErrorHandling(sourceFile, code, concepts.errorHandling);
	renderSecurity(code, concepts.security);
	renderResourceManagement(code, concepts.resourceManagement);
	renderAdvancedConcepts(code, concepts.advancedConcepts, concepts);

	return concepts;
}

function createConcepts(): TypeScriptConcepts {
	return {
		imports: [],
		exports: [],
		classes: [],
		functions: [],
		internalFunctions: [],
		parameters: [],
		returnTypes: [],
		variables: [],
		objects: [],
		messagePayloads: [],
		controlStructures: [],
		operators: [],
		asyncConcepts: [],
		eventConcepts: [],
		designPatterns: [],
		typeSystem: [],
		dataFlow: [],
		uiSystem: [],
		architecture: [],
		errorHandling: [],
		security: [],
		resourceManagement: [],
		advancedConcepts: []
	};
}

function collectImport(
	node: ts.ImportDeclaration,
	sourceFile: ts.SourceFile,
	typeUse: Set<string>,
	valueUse: Set<string>,
	imports: string[],
	typeImports: Set<string>
): void {
	const importClause = node.importClause;
	if (!importClause) {
		const moduleName = stringLiteralText(node.moduleSpecifier);
		if (moduleName) {
			addUnique(imports, `${moduleName} (side-effect import)`);
		}
		return;
	}

	const moduleName = stringLiteralText(node.moduleSpecifier);
	const fromText = moduleName ? ` from \`${moduleName}\`` : '';
	if (importClause.name) {
		const name = importClause.name.text;
		addUnique(imports, `${name} (default import${fromText})`);
	}

	const namedBindings = importClause.namedBindings;
	if (!namedBindings) {
		return;
	}

	if (ts.isNamespaceImport(namedBindings)) {
		addUnique(imports, `${namedBindings.name.text} (namespace import)`);
		return;
	}

	for (const specifier of namedBindings.elements) {
		const name = specifier.name.text;
		const isType =
			importClause.isTypeOnly ||
			specifier.isTypeOnly ||
			(typeUse.has(name) && !valueUse.has(name));
		if (isType) {
			typeImports.add(name);
		}
		addUnique(imports, `${name} (${isType ? 'type' : `named import${fromText}`})`);
	}

	sourceFile;
}

function collectClass(
	node: ts.ClassDeclaration,
	sourceFile: ts.SourceFile,
	scanFunctionSignature: (
		node:
			| ts.FunctionDeclaration
			| ts.MethodDeclaration
			| ts.ConstructorDeclaration
			| ts.ArrowFunction
			| ts.FunctionExpression
			| ts.FunctionTypeNode
	) => void,
	scanTypeNode: (node: ts.TypeNode | undefined) => void,
	scanBody: (node: ts.Node | undefined, scopeLabel: string) => void,
	optionalMembers: Set<string>,
	callbackPropertyNames: Set<string>
): ClassInfo {
	const info: ClassInfo = {
		name: node.name?.text ?? 'AnonymousClass',
		members: {
			staticProperties: [],
			readonlyProperties: [],
			mutableProperties: [],
			staticMethods: [],
			constructors: [],
			instanceMethods: []
		}
	};

	for (const member of node.members) {
		if (ts.isPropertyDeclaration(member)) {
			const name = getPropertyName(member.name, sourceFile);
			const typeText = member.type ? cleanTypeText(member.type.getText(sourceFile)) : 'unknown';
			const optional = member.questionToken ? '?' : '';
			const line = `${name}${optional}: ${typeText}`;
			if (member.questionToken) {
				optionalMembers.add(line);
			}
			if (hasModifier(member.modifiers, ts.SyntaxKind.StaticKeyword)) {
				addUnique(info.members.staticProperties, line);
			} else if (hasModifier(member.modifiers, ts.SyntaxKind.ReadonlyKeyword)) {
				addUnique(info.members.readonlyProperties, line);
			} else {
				addUnique(info.members.mutableProperties, line);
			}
			if (name.startsWith('on') && member.type && member.type.getText(sourceFile).includes('=>')) {
				callbackPropertyNames.add(name);
			}
			scanTypeNode(member.type);
			continue;
		}

		if (ts.isConstructorDeclaration(member)) {
			scanFunctionSignature(member);
			addUnique(info.members.constructors, formatConstructor(member, sourceFile));
			scanBody(member.body, 'constructor');
			continue;
		}

		if (ts.isMethodDeclaration(member)) {
			const name = getPropertyName(member.name, sourceFile);
			scanFunctionSignature(member);
			const signature = formatMethod(name, member, sourceFile);
			if (hasModifier(member.modifiers, ts.SyntaxKind.StaticKeyword)) {
				addUnique(info.members.staticMethods, signature);
			} else {
				addUnique(info.members.instanceMethods, signature);
			}
			scanBody(member.body, `${info.name}.${name}`);
		}
	}

	return info;
}

function collectTypeIdentifierUses(sourceFile: ts.SourceFile): Set<string> {
	const uses = new Set<string>();
	const visitTypeNode = (node: ts.Node): void => {
		if (ts.isIdentifier(node)) {
			uses.add(node.text);
		}
		ts.forEachChild(node, visitTypeNode);
	};
	const visit = (node: ts.Node): void => {
		if (hasTypeNode(node)) {
			const typeNode = node.type;
			if (typeNode) {
				visitTypeNode(typeNode);
			}
		}
		if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
			ts.forEachChild(node, visitTypeNode);
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return uses;
}

function collectValueIdentifierUses(sourceFile: ts.SourceFile): Set<string> {
	const uses = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isImportDeclaration(node) ||
			ts.isImportClause(node) ||
			ts.isImportSpecifier(node) ||
			ts.isTypeNode(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isTypeAliasDeclaration(node)
		) {
			return;
		}
		if (ts.isIdentifier(node)) {
			uses.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return uses;
}

function collectTypeSystemFromTypeNode(
	node: ts.TypeNode,
	unionTypes: Set<string>,
	genericTypes: Set<string>
): void {
	const visit = (child: ts.Node): void => {
		if (ts.isUnionTypeNode(child)) {
			unionTypes.add(cleanTypeText(child.getText()));
		}
		if (ts.isTypeReferenceNode(child) && child.typeArguments?.length) {
			genericTypes.add(cleanTypeText(child.getText()));
		}
		if (ts.isArrayTypeNode(child)) {
			genericTypes.add(cleanTypeText(child.getText()));
		}
		ts.forEachChild(child, visit);
	};
	visit(node);
}

function collectExportNames(node: ts.Statement, sourceFile: ts.SourceFile, exportedNames: Set<string>): void {
	if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
		for (const element of node.exportClause.elements) {
			exportedNames.add(element.name.text);
		}
	}
	if (ts.isExportAssignment(node)) {
		exportedNames.add(node.expression.getText(sourceFile));
	}
}

function collectMessageTypeCheck(
	node: ts.BinaryExpression,
	sourceFile: ts.SourceFile,
	messageTypes: Map<string, Set<string>>
): void {
	const operator = node.operatorToken.kind;
	if (operator !== ts.SyntaxKind.EqualsEqualsEqualsToken && operator !== ts.SyntaxKind.ExclamationEqualsEqualsToken) {
		return;
	}

	const leftText = node.left.getText(sourceFile);
	const rightText = node.right.getText(sourceFile);
	const typeValue = getStringLiteralComparisonValue(node.left, node.right) ?? getStringLiteralComparisonValue(node.right, node.left);
	if (!typeValue || !leftText.includes('msg') && !rightText.includes('msg')) {
		return;
	}

	const expressionText = node.parent.getText(sourceFile);
	const props = messageTypes.get(typeValue) ?? new Set<string>();
	for (const prop of MESSAGE_PROPS) {
		if (expressionText.includes(`.${prop}`) || expressionText.includes(`?.${prop}`)) {
			props.add(prop);
		}
	}
	messageTypes.set(typeValue, props);
}

function collectMessagePayload(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile, payloads: string[]): void {
	const typeProp = node.properties.find((prop): prop is ts.PropertyAssignment => {
		return (
			ts.isPropertyAssignment(prop) &&
			ts.isIdentifier(prop.name) &&
			prop.name.text === 'type' &&
			(ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))
		);
	});
	if (!typeProp) {
		return;
	}

	const parts: string[] = [`type: '${stringLiteralText(typeProp.initializer) ?? 'unknown'}'`];
	for (const prop of node.properties) {
		if (prop === typeProp) {
			continue;
		}
		if (ts.isShorthandPropertyAssignment(prop)) {
			parts.push(prop.name.text);
		} else if (ts.isPropertyAssignment(prop)) {
			parts.push(prop.name.getText(sourceFile));
		}
	}
	addUnique(payloads, `{ ${parts.join(', ')} }`);
}

function renderExports(exportedNames: Set<string>, classNames: Set<string>, exports: string[]): void {
	for (const name of [...exportedNames].sort((a, b) => a.localeCompare(b))) {
		const kind = classNames.has(name) ? 'class' : 'symbol';
		addUnique(exports, `${name} (${kind})`);
	}
}

function renderVariables(localVariableNames: Set<string>, variables: string[]): void {
	for (const name of [...localVariableNames].sort((a, b) => a.localeCompare(b))) {
		addUnique(variables, name);
	}
}

function renderReturnTypes(returnTypeTexts: Set<string>, returnTypes: string[]): void {
	for (const typeText of [...returnTypeTexts].sort((a, b) => a.localeCompare(b))) {
		addUnique(returnTypes, typeText);
	}
}

function renderObjects(typeImports: Set<string>, concepts: TypeScriptConcepts, code: string): void {
	for (const typeName of [...typeImports].sort((a, b) => a.localeCompare(b))) {
		addUnique(concepts.objects, typeName);
	}
	if (/\bmsg\?\./.test(code) || /\bmsg\./.test(code)) {
		addUnique(concepts.objects, 'msg (dynamic message object from webview)');
	}
	if (/\boptions\?\./.test(code) || /\boptions:?\s*\{/.test(code)) {
		addUnique(concepts.objects, 'options (configuration object)');
	}
	if (/\[\]/.test(code)) {
		addUnique(concepts.objects, 'Array-backed collections');
	}
	if (/\bMap\b/.test(code)) {
		addUnique(concepts.objects, 'Map');
	}
	if (/\bSet\b/.test(code)) {
		addUnique(concepts.objects, 'Set');
	}
}

function renderMessageTypeChecks(messageTypes: Map<string, Set<string>>, payloads: string[]): void {
	for (const [typeName, props] of [...messageTypes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		const parts = [`type: '${typeName}'`, ...[...props].sort((a, b) => a.localeCompare(b))];
		addUnique(payloads, `{ ${parts.join(', ')} }`);
	}
}

function renderControlStructures(sourceFile: ts.SourceFile, controlStructures: string[]): void {
	let hasIf = false;
	let hasElse = false;
	let hasTry = false;
	let hasWhile = false;
	let hasFor = false;
	let hasSwitch = false;
	let hasReturn = false;

	const visit = (node: ts.Node): void => {
		if (ts.isIfStatement(node)) {
			hasIf = true;
			if (node.elseStatement) {
				hasElse = true;
			}
		}
		if (ts.isTryStatement(node)) {
			hasTry = true;
		}
		if (ts.isWhileStatement(node)) {
			hasWhile = true;
		}
		if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
			hasFor = true;
		}
		if (ts.isSwitchStatement(node)) {
			hasSwitch = true;
		}
		if (ts.isReturnStatement(node)) {
			hasReturn = true;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	if (hasIf) {
		addUnique(controlStructures, '`if`');
	}
	if (hasElse) {
		addUnique(controlStructures, '`else`');
	}
	if (hasTry) {
		addUnique(controlStructures, '`try / catch`');
	}
	if (hasWhile) {
		addUnique(controlStructures, '`while`');
	}
	if (hasFor) {
		addUnique(controlStructures, '`for` / iteration');
	}
	if (hasSwitch) {
		addUnique(controlStructures, '`switch`');
	}
	if (hasReturn) {
		addUnique(controlStructures, 'early returns');
	}
}

function renderOperators(sourceFile: ts.SourceFile, strippedCode: string, operators: string[]): void {
	const found = {
		assignment: false,
		strictEquals: false,
		strictNotEquals: false,
		and: false,
		or: false,
		nullish: false,
		typeAssertion: false,
		ternary: false,
		arrow: false
	};

	const visit = (node: ts.Node): void => {
		if (ts.isBinaryExpression(node)) {
			switch (node.operatorToken.kind) {
				case ts.SyntaxKind.EqualsToken:
					found.assignment = true;
					break;
				case ts.SyntaxKind.EqualsEqualsEqualsToken:
					found.strictEquals = true;
					break;
				case ts.SyntaxKind.ExclamationEqualsEqualsToken:
					found.strictNotEquals = true;
					break;
				case ts.SyntaxKind.AmpersandAmpersandToken:
					found.and = true;
					break;
				case ts.SyntaxKind.BarBarToken:
					found.or = true;
					break;
				case ts.SyntaxKind.QuestionQuestionToken:
					found.nullish = true;
					break;
				default:
					break;
			}
		}
		if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
			found.typeAssertion = true;
		}
		if (ts.isConditionalExpression(node)) {
			found.ternary = true;
		}
		if (ts.isArrowFunction(node)) {
			found.arrow = true;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	if (found.assignment) {
		addUnique(operators, 'Assignment: `=`');
	}
	if (found.strictEquals) {
		addUnique(operators, 'Comparison: `===`');
	}
	if (found.strictNotEquals) {
		addUnique(operators, 'Comparison: `!==`');
	}
	if (found.and) {
		addUnique(operators, 'Logical: `&&`');
	}
	if (found.or) {
		addUnique(operators, 'Logical: `||`');
	}
	if (/\?\./.test(strippedCode)) {
		addUnique(operators, 'Optional chaining: `?.`');
	}
	if (found.nullish) {
		addUnique(operators, 'Nullish coalescing: `??`');
	}
	if (found.typeAssertion) {
		addUnique(operators, 'Type assertion: `as`');
	}
	if (found.ternary) {
		addUnique(operators, 'Ternary: `? :`');
	}
	if (found.arrow) {
		addUnique(operators, 'Arrow function: `=>`');
	}
}

function renderAsyncConcepts(
	sourceFile: ts.SourceFile,
	returnTypeTexts: Set<string>,
	eventCalls: Set<string>,
	asyncConcepts: string[]
): void {
	let hasAsync = false;
	let hasAwait = false;
	const visit = (node: ts.Node): void => {
		if (hasModifier((node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers, ts.SyntaxKind.AsyncKeyword)) {
			hasAsync = true;
		}
		if (ts.isAwaitExpression(node)) {
			hasAwait = true;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	if (hasAsync || hasAwait) {
		addUnique(asyncConcepts, '`async / await`');
	}
	if ([...returnTypeTexts].some((typeText) => typeText.includes('Promise<'))) {
		addUnique(asyncConcepts, 'Promise-based callbacks');
	}
	if ([...eventCalls].some((call) => call.includes('onDidReceiveMessage'))) {
		addUnique(asyncConcepts, 'Event-driven async handling (`onDidReceiveMessage`)');
	}
	if (hasAsync && hasTryCatch(sourceFile)) {
		addUnique(asyncConcepts, 'Error handling with async (`try / catch`)');
	}
}

function renderEventConcepts(eventCalls: Set<string>, eventConcepts: string[], code: string): void {
	for (const call of [...eventCalls].sort((a, b) => a.localeCompare(b))) {
		addUnique(eventConcepts, `\`${call}\``);
	}
	if (code.includes('postMessage')) {
		addUnique(eventConcepts, 'Message-based communication: UI -> extension and extension -> UI (`postMessage`)');
	}
}

function renderDesignPatterns(
	concepts: TypeScriptConcepts,
	callbackPropertyNames: Set<string>,
	eventCalls: Set<string>,
	messageTypes: Map<string, Set<string>>
): void {
	const hasStaticPanel = concepts.classes.some((item) =>
		item.members.staticProperties.some((property) => property.startsWith('currentPanel'))
	);
	const hasCreateOrShow = concepts.classes.some((item) =>
		item.members.staticMethods.some((method) => method.startsWith('createOrShow'))
	);
	if (hasStaticPanel) {
		addUnique(concepts.designPatterns, '**Singleton Pattern** - static `currentPanel` stores the active panel instance');
	}
	if (hasCreateOrShow) {
		addUnique(concepts.designPatterns, '**Factory Pattern** - `createOrShow()` creates or reuses the panel');
	}
	if (eventCalls.size) {
		addUnique(concepts.designPatterns, '**Observer Pattern** - event listeners react to VS Code/webview events');
	}
	if (messageTypes.size) {
		addUnique(concepts.designPatterns, '**Command Pattern (implicit)** - message `type` values route actions');
	}
	if (callbackPropertyNames.size || concepts.parameters.some((param) => param.startsWith('on'))) {
		addUnique(concepts.designPatterns, '**Dependency Injection** - callbacks such as `onNavigate` and `onRequestGraph` are supplied from outside');
	}
}

function renderTypeSystem(
	typeImports: Set<string>,
	unionTypes: Set<string>,
	optionalMembers: Set<string>,
	genericTypes: Set<string>,
	typeSystem: string[]
): void {
	for (const name of [...typeImports].sort((a, b) => a.localeCompare(b))) {
		addUnique(typeSystem, `Type/interface usage: \`${name}\``);
	}
	for (const unionType of [...unionTypes].sort((a, b) => a.localeCompare(b))) {
		addUnique(typeSystem, `Union type: \`${unionType}\``);
	}
	if (optionalMembers.size) {
		addUnique(typeSystem, 'Optional properties/parameters (`?`)');
	}
	for (const genericType of [...genericTypes].sort((a, b) => a.localeCompare(b))) {
		addUnique(typeSystem, `Generic type: \`${genericType}\``);
	}
}

function renderUiSystem(code: string, uiSystem: string[]): void {
	if (code.includes('vscode.WebviewPanel') || code.includes('createWebviewPanel')) {
		addUnique(uiSystem, 'Webview rendering (`vscode.WebviewPanel`)');
	}
	if (code.includes('<html') || code.includes('<!DOCTYPE html>')) {
		addUnique(uiSystem, 'HTML generation with template strings');
	}
	if (code.includes('Content-Security-Policy')) {
		addUnique(uiSystem, 'CSP (Content Security Policy)');
	}
	if (code.includes('asWebviewUri')) {
		addUnique(uiSystem, 'Resource URI mapping (`asWebviewUri`)');
	}
	if (code.includes('type="importmap"') || code.includes('importmap')) {
		addUnique(uiSystem, 'Import maps for browser module loading');
	}
	if (code.includes('three')) {
		addUnique(uiSystem, 'Three.js resource loading');
	}
}

function renderArchitecture(code: string, architecture: string[]): void {
	if (code.includes('CircuitPanel') && code.includes('Webview')) {
		addUnique(architecture, '**Separation of Concerns** - controller code coordinates webview UI and extension callbacks');
	}
	if (code.includes('../../shared/types') || code.includes('../services') || code.includes('./')) {
		addUnique(architecture, '**Layered Architecture** - controller, services/callbacks, and shared types are separated');
	}
	if (code.includes('CircuitGraph') || code.includes('CircuitNode')) {
		addUnique(architecture, '**Graph-based Visualization Model** - graph nodes and edges drive UI state');
	}
	if (code.includes('vscode.')) {
		addUnique(architecture, '**Plugin/Extension Architecture** - VS Code APIs provide panels, events, and user feedback');
	}
}

function renderErrorHandling(sourceFile: ts.SourceFile, code: string, errorHandling: string[]): void {
	if (hasTryCatch(sourceFile)) {
		addUnique(errorHandling, 'Graceful fallback with `try / catch`');
	}
	if (code.includes('showInformationMessage')) {
		addUnique(errorHandling, 'User feedback through `vscode.window.showInformationMessage`');
	}
	if (code.includes('error?.message') || code.includes('String(error')) {
		addUnique(errorHandling, 'Safe error extraction with `error?.message ?? String(error)`');
	}
}

function renderSecurity(code: string, security: string[]): void {
	if (code.includes('Content-Security-Policy')) {
		addUnique(security, 'CSP enforcement');
	}
	if (code.includes('getNonce()') || code.includes('nonce')) {
		addUnique(security, 'Nonce usage for webview scripts');
	}
	if (code.includes("replace(/</g") || code.includes('\\u003c')) {
		addUnique(security, 'Sanitization for embedded JSON/HTML (`replace(/</g, ...)`)');
	}
	if (code.includes('localResourceRoots')) {
		addUnique(security, 'Local resource root restriction for webview assets');
	}
}

function renderResourceManagement(code: string, resourceManagement: string[]): void {
	if (code.includes('disposables')) {
		addUnique(resourceManagement, 'Disposable pattern: `this.disposables`');
	}
	if (/\bdispose\(\)/.test(code) || /\bdispose\(\):/.test(code)) {
		addUnique(resourceManagement, 'Cleanup lifecycle: `dispose()`');
	}
	if (code.includes('onDidDispose')) {
		addUnique(resourceManagement, 'Panel lifecycle hook: `onDidDispose`');
	}
	if (code.includes('while (this.disposables.length)')) {
		addUnique(resourceManagement, 'Loop-based disposal cleanup');
	}
}

function renderAdvancedConcepts(code: string, advanced: string[], concepts: TypeScriptConcepts): void {
	if (code.includes('CircuitGraph') || code.includes('setGraph')) {
		addUnique(advanced, '**Graph Transformation**');
	}
	if (code.includes('Ai') || code.includes('AI') || code.includes('Enrichment')) {
		addUnique(advanced, '**AI-Augmented Code Analysis**');
	}
	if (code.includes('<html') || code.includes('webview.html')) {
		addUnique(advanced, '**Dynamic UI Generation**');
	}
	if (concepts.eventConcepts.length && concepts.dataFlow.length) {
		addUnique(advanced, '**Event-driven state synchronization**');
	}
	if (concepts.asyncConcepts.length) {
		addUnique(advanced, '**Asynchronous orchestration layer**');
	}
	if (concepts.designPatterns.some((pattern) => pattern.includes('Dependency Injection'))) {
		addUnique(advanced, '**Extensible architecture via callbacks**');
	}
}

function renderConcepts(concepts: TypeScriptConcepts, document: vscode.TextDocument): string {
	const blocks: string[] = [
		'Here is a **strict structured extraction** of the active file.',
		`File: \`${vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, '/')}\``,
		''
	];

	pushSection(blocks, 'IMPORTS', concepts.imports);
	pushSection(blocks, 'EXPORTS', concepts.exports);
	pushSection(blocks, 'CLASSES', concepts.classes.map((item) => item.name));
	pushClassProperties(blocks, concepts.classes);
	pushMethods(blocks, concepts.classes, concepts.functions);
	pushSection(blocks, 'INTERNAL / INLINE FUNCTIONS', concepts.internalFunctions);
	pushSection(blocks, 'PARAMETERS', concepts.parameters);
	pushSection(blocks, 'RETURN TYPES', concepts.returnTypes);
	pushSection(blocks, 'VARIABLES', concepts.variables);
	pushObjectsSection(blocks, concepts);
	pushSection(blocks, 'CONTROL STRUCTURES', concepts.controlStructures);
	pushSection(blocks, 'OPERATORS', concepts.operators);
	pushSection(blocks, 'ASYNC / CONCURRENCY CONCEPTS', concepts.asyncConcepts);
	pushSection(blocks, 'EVENT-DRIVEN ARCHITECTURE', concepts.eventConcepts);
	pushSection(blocks, 'DESIGN PATTERNS', concepts.designPatterns);
	pushSection(blocks, 'TYPE SYSTEM (TYPESCRIPT)', concepts.typeSystem);
	pushSection(blocks, 'DATA FLOW CONCEPTS', concepts.dataFlow);
	pushSection(blocks, 'UI / SYSTEM CONCEPTS', concepts.uiSystem);
	pushSection(blocks, 'ARCHITECTURAL CONCEPTS', concepts.architecture);
	pushSection(blocks, 'ERROR HANDLING', concepts.errorHandling);
	pushSection(blocks, 'SECURITY CONCEPTS', concepts.security);
	pushSection(blocks, 'MEMORY / RESOURCE MANAGEMENT', concepts.resourceManagement);
	pushSection(blocks, 'ADVANCED CONCEPTS', concepts.advancedConcepts);

	return blocks.join('\n').trim();
}

function pushSection(blocks: string[], heading: string, items: string[]): void {
	blocks.push(`---\n\n# ${heading}\n`);
	if (!items.length) {
		blocks.push(EMPTY, '');
		return;
	}
	for (const item of items) {
		blocks.push(`* ${formatItem(item)}`);
	}
	blocks.push('');
}

function pushClassProperties(blocks: string[], classes: ClassInfo[]): void {
	blocks.push('---\n\n# CLASS PROPERTIES\n');
	if (!classes.length || classes.every((item) => allClassPropertyGroupsEmpty(item.members))) {
		blocks.push(EMPTY, '');
		return;
	}

	for (const item of classes) {
		blocks.push(`## ${item.name}`);
		pushSubList(blocks, 'Static', item.members.staticProperties);
		pushSubList(blocks, 'Instance (readonly)', item.members.readonlyProperties);
		pushSubList(blocks, 'Instance (mutable)', item.members.mutableProperties);
	}
	blocks.push('');
}

function pushMethods(blocks: string[], classes: ClassInfo[], functions: string[]): void {
	blocks.push('---\n\n# FUNCTIONS / METHODS\n');
	let hasAny = false;
	for (const item of classes) {
		if (
			item.members.staticMethods.length ||
			item.members.constructors.length ||
			item.members.instanceMethods.length
		) {
			hasAny = true;
			blocks.push(`## ${item.name}`);
			pushSubList(blocks, 'Static Methods', item.members.staticMethods);
			pushSubList(blocks, 'Constructor', item.members.constructors);
			pushSubList(blocks, 'Instance Methods', item.members.instanceMethods);
		}
	}
	if (functions.length) {
		hasAny = true;
		pushSubList(blocks, 'Top-level Functions', functions);
	}
	if (!hasAny) {
		blocks.push(EMPTY);
	}
	blocks.push('');
}

function pushObjectsSection(blocks: string[], concepts: TypeScriptConcepts): void {
	blocks.push('---\n\n# OBJECTS / DATA STRUCTURES\n');
	if (!concepts.objects.length && !concepts.messagePayloads.length) {
		blocks.push(EMPTY, '');
		return;
	}
	for (const item of concepts.objects) {
		blocks.push(`* ${formatItem(item)}`);
	}
	if (concepts.messagePayloads.length) {
		blocks.push('');
		blocks.push('## Webview message payloads');
		for (const payload of concepts.messagePayloads) {
			blocks.push(`* \`${payload}\``);
		}
	}
	blocks.push('');
}

function pushSubList(blocks: string[], heading: string, items: string[]): void {
	if (!items.length) {
		return;
	}
	blocks.push(`### ${heading}`);
	for (const item of items) {
		blocks.push(`* ${formatItem(item)}`);
	}
	blocks.push('');
}

function allClassPropertyGroupsEmpty(members: ClassMemberGroup): boolean {
	return !members.staticProperties.length && !members.readonlyProperties.length && !members.mutableProperties.length;
}

function formatItem(item: string): string {
	if (!item) {
		return EMPTY;
	}
	if (item.includes('`') || item.includes('**')) {
		return item;
	}
	return isCodeLikeItem(item) ? `\`${item}\`` : item;
}

function isCodeLikeItem(item: string): boolean {
	const value = item.trim();
	if (!value) {
		return false;
	}

	// Long explanatory phrases should render as readable prose, not code pills.
	if (/\s{2,}/.test(value) || value.split(/\s+/).length > 4) {
		return false;
	}

	// Pattern-like lines (already intentionally formatted by the analyzer).
	if (value.startsWith('**') || value.startsWith('`')) {
		return false;
	}

	// Typical identifier/type/token shapes.
	if (/^[A-Za-z_$][\w$]*(?:[.:][A-Za-z_$][\w$]*)*$/.test(value)) {
		return true;
	}
	if (/^[A-Za-z_$][\w$]*(<[^>]+>)?$/.test(value)) {
		return true;
	}
	if (/^[A-Za-z_$][\w$]*\([^)]*\)(?::\s*.+)?$/.test(value)) {
		return true;
	}
	if (/^(?:\{[^}]+\}|\[[^\]]+\])$/.test(value)) {
		return true;
	}
	if (/^[^a-zA-Z]*[=<>!&|?:.+\-/*%()[\]{}]+[^a-zA-Z]*$/.test(value)) {
		return true;
	}

	return false;
}

function buildGenericConceptOutput(document: vscode.TextDocument): string {
	const code = document.getText();
	const imports = collectRegexMatches(code, /^\s*(?:import|from)\s+(.+)$/gm);
	const functions = collectRegexMatches(code, /\b(?:function|def)\s+([A-Za-z_$][\w$]*)/g);
	const classes = collectRegexMatches(code, /\bclass\s+([A-Za-z_$][\w$]*)/g);
	const variables = collectRegexMatches(code, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
	const concepts = createConcepts();
	concepts.imports.push(...imports);
	concepts.classes.push(...classes.map((name) => ({
		name,
		members: {
			staticProperties: [],
			readonlyProperties: [],
			mutableProperties: [],
			staticMethods: [],
			constructors: [],
			instanceMethods: []
		}
	})));
	concepts.functions.push(...functions);
	concepts.variables.push(...variables);
	if (/\bif\b/.test(code)) {
		concepts.controlStructures.push('`if`');
	}
	if (/\bfor\b|\bwhile\b/.test(code)) {
		concepts.controlStructures.push('loops');
	}
	if (/\basync\b|\bawait\b|Promise/.test(code)) {
		concepts.asyncConcepts.push('async/concurrency syntax');
	}
	return renderConcepts(concepts, document);
}

function collectRegexMatches(code: string, regex: RegExp): string[] {
	const out = new Set<string>();
	for (const match of code.matchAll(regex)) {
		const value = match[1]?.trim();
		if (value) {
			out.add(value);
		}
	}
	return [...out].sort((a, b) => a.localeCompare(b));
}

function formatConstructor(node: ts.ConstructorDeclaration, sourceFile: ts.SourceFile): string {
	return `constructor(${formatParams(node.parameters, sourceFile)})`;
}

function formatMethod(name: string, node: ts.MethodDeclaration, sourceFile: ts.SourceFile): string {
	const returnType = node.type ? cleanTypeText(node.type.getText(sourceFile)) : 'void';
	return `${name}(${formatParams(node.parameters, sourceFile)}): ${returnType}`;
}

function formatFunctionLike(
	name: string,
	node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
	sourceFile: ts.SourceFile
): string {
	const returnType = node.type ? cleanTypeText(node.type.getText(sourceFile)) : 'inferred';
	return `${name}(${formatParams(node.parameters, sourceFile)}): ${returnType}`;
}

function formatParams(params: ts.NodeArray<ts.ParameterDeclaration>, sourceFile: ts.SourceFile): string {
	return params
		.map((param) => {
			const name = param.name.getText(sourceFile);
			const optional = param.questionToken ? '?' : '';
			const typeText = param.type ? `: ${cleanTypeText(param.type.getText(sourceFile))}` : '';
			return `${name}${optional}${typeText}`;
		})
		.join(', ');
}

function getBindingNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) {
		return [name.text];
	}
	const names: string[] = [];
	for (const element of name.elements) {
		if (ts.isBindingElement(element)) {
			names.push(...getBindingNames(element.name));
		}
	}
	return names;
}

function getPropertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return name.getText(sourceFile);
}

function getCallName(expression: ts.Expression): string | undefined {
	if (ts.isIdentifier(expression)) {
		return expression.text;
	}
	if (ts.isPropertyAccessExpression(expression)) {
		const base = getCallName(expression.expression);
		return base ? `${base}.${expression.name.text}` : expression.name.text;
	}
	return undefined;
}

function stringLiteralText(node: ts.Node): string | undefined {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text;
	}
	return undefined;
}

function getStringLiteralComparisonValue(left: ts.Expression, right: ts.Expression): string | undefined {
	if ((left.getText().includes('.type') || left.getText().includes('?.type')) && (ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right))) {
		return right.text;
	}
	return undefined;
}

function cleanTypeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function hasTypeNode(node: ts.Node): node is ts.Node & { type?: ts.TypeNode } {
	return 'type' in node;
}

function hasTryCatch(sourceFile: ts.SourceFile): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (ts.isTryStatement(node)) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

function hasModifier(modifiers: ts.NodeArray<ts.ModifierLike> | undefined, kind: ts.SyntaxKind): boolean {
	return !!modifiers?.some((modifier) => modifier.kind === kind);
}

function addUnique(items: string[], value: string): void {
	const normalized = value.trim();
	if (normalized && !items.includes(normalized)) {
		items.push(normalized);
	}
}

function isTypeScriptLike(languageId: string): boolean {
	return ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId.toLowerCase());
}

function inferScriptKind(languageId: string): ts.ScriptKind {
	switch (languageId) {
		case 'javascript':
			return ts.ScriptKind.JS;
		case 'javascriptreact':
			return ts.ScriptKind.JSX;
		case 'typescriptreact':
			return ts.ScriptKind.TSX;
		default:
			return ts.ScriptKind.TS;
	}
}

function inferFileName(languageId: string): string {
	switch (languageId) {
		case 'javascript':
			return 'file.js';
		case 'javascriptreact':
			return 'file.jsx';
		case 'typescriptreact':
			return 'file.tsx';
		default:
			return 'file.ts';
	}
}

function stripStringLikeLiterals(code: string, sourceFile: ts.SourceFile): string {
	const ranges: Array<[number, number]> = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateExpression(node)
		) {
			ranges.push([node.getStart(sourceFile), node.getEnd()]);
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	if (!ranges.length) {
		return code;
	}

	const chars = code.split('');
	for (const [start, end] of ranges) {
		for (let i = start; i < end; i++) {
			if (chars[i] !== '\n' && chars[i] !== '\r') {
				chars[i] = ' ';
			}
		}
	}
	return chars.join('');
}
