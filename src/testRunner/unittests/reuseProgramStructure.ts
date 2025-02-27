import * as Harness from "../_namespaces/Harness";
import * as ts from "../_namespaces/ts";
import * as Utils from "../_namespaces/Utils";
import {
    createTestCompilerHost,
    NamedSourceText,
    newLine,
    newProgram,
    ProgramWithSourceTexts,
    SourceText,
    TestCompilerHost,
    updateProgram,
    updateProgramText,
} from "./helpers";
import {
    createWatchedSystem,
    File,
    libFile,
} from "./helpers/virtualFileSystemWithWatch";

describe("unittests:: Reuse program structure:: General", () => {
    function baselineCache<T>(baselines: string[], cacheType: string, cache: ts.ModeAwareCache<T> | undefined) {
        baselines.push(`${cacheType}: ${!cache ? cache : ""}`);
        cache?.forEach((resolved, key, mode) => baselines.push(`${key}: ${mode ? ts.getNameOfCompilerOptionValue(mode, ts.moduleOptionDeclaration.type) + ": " : ""}${JSON.stringify(resolved, /*replacer*/ undefined, 2)}`));
    }
    function baselineProgram(baselines: string[], program: ts.Program, host?: TestCompilerHost) {
        baselines.push(`Program Reused:: ${(ts as any).StructureIsReused[program.structureIsReused]}`);
        program.getSourceFiles().forEach(f => {
            baselines.push(`File: ${f.fileName}`, f.text);
            baselineCache(baselines, "resolvedModules", f.resolvedModules);
            baselineCache(baselines, "resolvedTypeReferenceDirectiveNames", f.resolvedTypeReferenceDirectiveNames);
            baselines.push("");
        });
        host ??= (program as ProgramWithSourceTexts).host;
        host.getTrace().forEach(trace => baselines.push(Utils.sanitizeTraceResolutionLogEntry(trace)));
        host.clearTrace();
        baselines.push("");
        baselines.push(`MissingPaths:: ${JSON.stringify(program.getMissingFilePaths())}`);
        baselines.push("");
        baselines.push(ts.formatDiagnostics(program.getSemanticDiagnostics(), {
            getCurrentDirectory: () => program.getCurrentDirectory(),
            getNewLine: () => "\n",
            getCanonicalFileName: ts.createGetCanonicalFileName(program.useCaseSensitiveFileNames())
        }));
        baselines.push("", "");
    }

    function runBaseline(scenario: string, baselines: readonly string[]) {
        Harness.Baseline.runBaseline(`reuseProgramStructure/${scenario.split(" ").join("-")}.js`, baselines.join("\n"));
    }

    const target = ts.ScriptTarget.Latest;
    function getFiles(): NamedSourceText[] {
        return [
            {
                name: "a.ts", text: SourceText.New(`
/// <reference path='b.ts'/>
/// <reference path='non-existing-file.ts'/>
/// <reference types="typerefs" />
`, "", `var x = 1`)
            },
            { name: "b.ts", text: SourceText.New(`/// <reference path='c.ts'/>`, "", `var y = 2`) },
            { name: "c.ts", text: SourceText.New("", "", `var z = 1;`) },
            { name: "types/typerefs/index.d.ts", text: SourceText.New("", "", `declare let z: number;`) },
        ];
    }

    it("successful if change does not affect imports or type refs", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target }, files => {
            files[0].text = files[0].text.updateProgram("var x = 100");
        });
        baselineProgram(baselines, program2);
        runBaseline("change does not affect imports or type refs", baselines);
    });

    it("successful if change affects a single module of a package", () => {
        const files = [
            { name: "/a.ts", text: SourceText.New("", "import {b} from 'b'", "var a = b;") },
            { name: "/node_modules/b/index.d.ts", text: SourceText.New("", "export * from './internal';", "") },
            { name: "/node_modules/b/internal.d.ts", text: SourceText.New("", "", "export const b = 1;") },
            { name: "/node_modules/b/package.json", text: SourceText.New("", "", JSON.stringify({ name: "b", version: "1.2.3" })) },
        ];

        const options: ts.CompilerOptions = { target, moduleResolution: ts.ModuleResolutionKind.Node10 };
        const program1 = newProgram(files, ["/a.ts"], options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["/a.ts"], options, files => {
            files[2].text = files[2].text.updateProgram("export const b = 2;");
        });
        baselineProgram(baselines, program2);
        runBaseline("change affects a single module of a package", baselines);
    });

    it("fails if change affects tripleslash references", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target }, files => {
            const newReferences = `/// <reference path='b.ts'/>
                /// <reference path='c.ts'/>
                `;
            files[0].text = files[0].text.updateReferences(newReferences);
        });
        baselineProgram(baselines, program2);
        runBaseline("change affects tripleslash references", baselines);
    });

    it("fails if change affects type references", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { types: ["a"] });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { types: ["b"] }, ts.noop);
        baselineProgram(baselines, program2);
        runBaseline("change affects type references", baselines);
    });

    it("succeeds if change doesn't affect type references", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { types: ["a"] });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { types: ["a"] }, ts.noop);
        baselineProgram(baselines, program2);
        runBaseline("change doesnot affect type references", baselines);
    });

    it("fails if change affects imports", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target }, files => {
            files[2].text = files[2].text.updateImportsAndExports("import x from 'b'");
        });
        baselineProgram(baselines, program2);
        runBaseline("change affects imports", baselines);
    });

    it("fails if change affects type directives", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target }, files => {
            const newReferences = `
/// <reference path='b.ts'/>
/// <reference path='non-existing-file.ts'/>
/// <reference types="typerefs1" />`;
            files[0].text = files[0].text.updateReferences(newReferences);
        });
        baselineProgram(baselines, program2);
        runBaseline("change affects type directives", baselines);
    });

    it("fails if module kind changes", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target, module: ts.ModuleKind.CommonJS });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target, module: ts.ModuleKind.AMD }, ts.noop);
        baselineProgram(baselines, program2);
        runBaseline("module kind changes", baselines);
    });

    it("succeeds if rootdir changes", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target, module: ts.ModuleKind.CommonJS, rootDir: "/a/b" });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target, module: ts.ModuleKind.CommonJS, rootDir: "/a/c" }, ts.noop);
        baselineProgram(baselines, program2);
        runBaseline("rootdir changes", baselines);
    });

    it("fails if config path changes", () => {
        const program1 = newProgram(getFiles(), ["a.ts"], { target, module: ts.ModuleKind.CommonJS, configFilePath: "/a/b/tsconfig.json" });
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], { target, module: ts.ModuleKind.CommonJS, configFilePath: "/a/c/tsconfig.json" }, ts.noop);
        baselineProgram(baselines, program2);
        runBaseline("config path changes", baselines);
    });

    it("succeeds if missing files remain missing", () => {
        const options: ts.CompilerOptions = { target, noLib: true };
        const program1 = newProgram(getFiles(), ["a.ts"], options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], options, ts.noop);
        baselineProgram(baselines, program2);
        runBaseline("missing files remain missing", baselines);
    });

    it("fails if missing file is created", () => {
        const options: ts.CompilerOptions = { target, noLib: true };
        const files = getFiles();
        const program1 = newProgram(files, ["a.ts"], options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const newTexts: NamedSourceText[] = files.concat([{ name: "non-existing-file.ts", text: SourceText.New("", "", `var x = 1`) }]);
        const program2 = updateProgram(program1, ["a.ts"], options, ts.noop, newTexts);
        baselineProgram(baselines, program2);
        runBaseline("missing file is created", baselines);
    });

    it("resolution cache follows imports", () => {
        (Error as any).stackTraceLimit = Infinity;

        const files = [
            { name: "a.ts", text: SourceText.New("", "import {_} from 'b'", "var x = 1") },
            { name: "b.ts", text: SourceText.New("", "", "var y = 2") },
        ];
        const options: ts.CompilerOptions = { target };
        const program1 = newProgram(files, ["a.ts"], options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["a.ts"], options, files => {
            files[0].text = files[0].text.updateProgram("var x = 2");
        });
        baselineProgram(baselines, program2);

        // imports has changed - program is not reused
        const program3 = updateProgram(program2, ["a.ts"], options, files => {
            files[0].text = files[0].text.updateImportsAndExports("");
        });
        baselineProgram(baselines, program3);

        const program4 = updateProgram(program3, ["a.ts"], options, files => {
            const newImports = `import x from 'b'
                import y from 'c'
                `;
            files[0].text = files[0].text.updateImportsAndExports(newImports);
        });
        baselineProgram(baselines, program4);
        runBaseline("resolution cache follows imports", baselines);
    });

    it("set the resolvedImports after re-using an ambient external module declaration", () => {
        const files = [
            { name: "/a.ts", text: SourceText.New("", "", 'import * as a from "a";') },
            { name: "/types/zzz/index.d.ts", text: SourceText.New("", "", 'declare module "a" { }') },
        ];
        const options: ts.CompilerOptions = { target, typeRoots: ["/types"] };
        const program1 = newProgram(files, ["/a.ts"], options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const program2 = updateProgram(program1, ["/a.ts"], options, files => {
            files[0].text = files[0].text.updateProgram('import * as aa from "a";');
        });
        baselineProgram(baselines, program2);
        runBaseline("resolvedImports after re-using an ambient external module declaration", baselines);
    });

    it("works with updated SourceFiles", () => {
        // adapted repro from https://github.com/Microsoft/TypeScript/issues/26166
        const files = [
            { name: "/a.ts", text: SourceText.New("", "", 'import * as a from "a";a;') },
            { name: "/types/zzz/index.d.ts", text: SourceText.New("", "", 'declare module "a" { }') },
        ];
        const host = createTestCompilerHost(files, target);
        const options: ts.CompilerOptions = { target, typeRoots: ["/types"] };
        const program1 = ts.createProgram(["/a.ts"], options, host);
        let sourceFile = program1.getSourceFile("/a.ts")!;
        const baselines: string[] = [];
        baselineProgram(baselines, program1, host);
        sourceFile = ts.updateSourceFile(sourceFile, "'use strict';" + sourceFile.text, { newLength: "'use strict';".length, span: { start: 0, length: 0 } });
        baselines.push(`parent pointers are updated: ${sourceFile.statements[2].getSourceFile() === sourceFile}`);
        const updateHost: TestCompilerHost = {
            ...host,
            getSourceFile(fileName) {
                return fileName === sourceFile.fileName ? sourceFile : program1.getSourceFile(fileName);
            }
        };
        const program2 = ts.createProgram(["/a.ts"], options, updateHost, program1);
        baselineProgram(baselines, program2, updateHost);
        baselines.push(`parent pointers are not altered: ${sourceFile.statements[2].getSourceFile() === sourceFile}`);
        runBaseline("works with updated SourceFiles", baselines);
    });

    it("resolved type directives cache follows type directives", () => {
        const files = [
            { name: "/a.ts", text: SourceText.New("/// <reference types='typedefs'/>", "", "var x = $") },
            { name: "/types/typedefs/index.d.ts", text: SourceText.New("", "", "declare var $: number") },
        ];
        const options: ts.CompilerOptions = { target, typeRoots: ["/types"] };

        const program1 = newProgram(files, ["/a.ts"], options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);

        const program2 = updateProgram(program1, ["/a.ts"], options, files => {
            files[0].text = files[0].text.updateProgram("var x = 2");
        });
        baselineProgram(baselines, program2);

        // type reference directives has changed - program is not reused
        const program3 = updateProgram(program2, ["/a.ts"], options, files => {
            files[0].text = files[0].text.updateReferences("");
        });

        baselineProgram(baselines, program3);

        const program4 = updateProgram(program3, ["/a.ts"], options, files => {
            const newReferences = `/// <reference types="typedefs"/>
                /// <reference types="typedefs2"/>
                `;
            files[0].text = files[0].text.updateReferences(newReferences);
        });
        baselineProgram(baselines, program4);
        runBaseline("resolved type directives cache follows type directives", baselines);
    });

    it("fetches imports after npm install", () => {
        const file1Ts = { name: "file1.ts", text: SourceText.New("", `import * as a from "a";`, "const myX: number = a.x;") };
        const file2Ts = { name: "file2.ts", text: SourceText.New("", "", "") };
        const indexDTS = { name: "node_modules/a/index.d.ts", text: SourceText.New("", "export declare let x: number;", "") };
        const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2015, traceResolution: true, moduleResolution: ts.ModuleResolutionKind.Node10 };
        const rootFiles = [file1Ts, file2Ts];
        const filesAfterNpmInstall = [file1Ts, file2Ts, indexDTS];
        const initialProgram = newProgram(rootFiles, rootFiles.map(f => f.name), options);
        const baselines: string[] = [];
        baselineProgram(baselines, initialProgram);

        const afterNpmInstallProgram = updateProgram(initialProgram, rootFiles.map(f => f.name), options, f => {
            f[1].text = f[1].text.updateReferences(`/// <reference no-default-lib="true"/>`);
        }, filesAfterNpmInstall);
        baselineProgram(baselines, afterNpmInstallProgram);

        runBaseline("fetches imports after npm install", baselines);
    });

    it("can reuse ambient module declarations from non-modified files", () => {
        const files = [
            { name: "/a/b/app.ts", text: SourceText.New("", "import * as fs from 'fs'", "") },
            { name: "/a/b/node.d.ts", text: SourceText.New("", "", "declare module 'fs' {}") }
        ];
        const options = { target: ts.ScriptTarget.ES2015, traceResolution: true };
        const program = newProgram(files, files.map(f => f.name), options);
        const baselines: string[] = [];
        baselineProgram(baselines, program);

        const program2 = updateProgram(program, program.getRootFileNames(), options, f => {
            f[0].text = f[0].text.updateProgram("var x = 1;");
        });
        baselineProgram(baselines, program2);

        const program3 = updateProgram(program2, program2.getRootFileNames(), options, f => {
            f[0].text = f[0].text.updateProgram("var y = 1;");
            f[1].text = f[1].text.updateProgram("declare var process: any");
        });
        baselineProgram(baselines, program3);
        runBaseline("can reuse ambient module declarations from non-modified files", baselines);
    });

    it("can reuse module resolutions from non-modified files", () => {
        const files = [
            { name: "a1.ts", text: SourceText.New("", "", "let x = 1;") },
            { name: "a2.ts", text: SourceText.New("", "", "let x = 1;") },
            { name: "b1.ts", text: SourceText.New("", "export class B { x: number; }", "") },
            { name: "b2.ts", text: SourceText.New("", "export class B { x: number; }", "") },
            { name: "node_modules/@types/typerefs1/index.d.ts", text: SourceText.New("", "", "declare let z: string;") },
            { name: "node_modules/@types/typerefs2/index.d.ts", text: SourceText.New("", "", "declare let z: string;") },
            {
                name: "f1.ts",
                text:
                    SourceText.New(
                        `/// <reference path="a1.ts"/>${newLine}/// <reference types="typerefs1"/>${newLine}/// <reference no-default-lib="true"/>`,
                        `import { B } from './b1';${newLine}export let BB = B;`,
                        "declare module './b1' { interface B { y: string; } }")
            },
            {
                name: "f2.ts",
                text: SourceText.New(
                    `/// <reference path="a2.ts"/>${newLine}/// <reference types="typerefs2"/>`,
                    `import { B } from './b2';${newLine}import { BB } from './f1';`,
                    "(new BB).x; (new BB).y;")
            },
        ];

        const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2015, traceResolution: true, moduleResolution: ts.ModuleResolutionKind.Classic };
        const program1 = newProgram(files, files.map(f => f.name), options);
        const baselines: string[] = [];
        baselineProgram(baselines, program1);
        const indexOfF1 = 6;
        const program2 = updateProgram(program1, program1.getRootFileNames(), options, f => {
            const newSourceText = f[indexOfF1].text.updateReferences(`/// <reference path="a1.ts"/>${newLine}/// <reference types="typerefs1"/>`);
            f[indexOfF1] = { name: "f1.ts", text: newSourceText };
        });
        baselineProgram(baselines, program2);

        const program3 = updateProgram(program2, program2.getRootFileNames(), options, f => {
            const newSourceText = f[indexOfF1].text.updateReferences(`/// <reference path="a1.ts"/>`);
            f[indexOfF1] = { name: "f1.ts", text: newSourceText };
        });
        baselineProgram(baselines, program3);

        const program4 = updateProgram(program3, program3.getRootFileNames(), options, f => {
            const newSourceText = f[indexOfF1].text.updateReferences("");
            f[indexOfF1] = { name: "f1.ts", text: newSourceText };
        });
        baselineProgram(baselines, program4);

        const program5 = updateProgram(program4, program4.getRootFileNames(), options, f => {
            const newSourceText = f[indexOfF1].text.updateImportsAndExports(`import { B } from './b1';`);
            f[indexOfF1] = { name: "f1.ts", text: newSourceText };
        });
        baselineProgram(baselines, program5);

        const program6 = updateProgram(program5, program5.getRootFileNames(), options, f => {
            const newSourceText = f[indexOfF1].text.updateProgram("");
            f[indexOfF1] = { name: "f1.ts", text: newSourceText };
        });
        baselineProgram(baselines, program6);

        const program7 = updateProgram(program6, program6.getRootFileNames(), options, f => {
            const newSourceText = f[indexOfF1].text.updateImportsAndExports("");
            f[indexOfF1] = { name: "f1.ts", text: newSourceText };
        });
        baselineProgram(baselines, program7);
        runBaseline("can reuse module resolutions from non-modified files", baselines);
    });

    describe("redirects", () => {
        const axIndex = "/node_modules/a/node_modules/x/index.d.ts";
        const axPackage = "/node_modules/a/node_modules/x/package.json";
        const bxIndex = "/node_modules/b/node_modules/x/index.d.ts";
        const bxPackage = "/node_modules/b/node_modules/x/package.json";
        const root = "/a.ts";
        const compilerOptions = { target, moduleResolution: ts.ModuleResolutionKind.Node10 };

        function createRedirectProgram(useGetSourceFileByPath: boolean, options?: { bText: string, bVersion: string }): ProgramWithSourceTexts {
            const files: NamedSourceText[] = [
                {
                    name: "/node_modules/a/index.d.ts",
                    text: SourceText.New("", 'import X from "x";', "export function a(x: X): void;"),
                },
                {
                    name: axIndex,
                    text: SourceText.New("", "", "export default class X { private x: number; }"),
                },
                {
                    name: axPackage,
                    text: SourceText.New("", "", JSON.stringify({ name: "x", version: "1.2.3" })),
                },
                {
                    name: "/node_modules/b/index.d.ts",
                    text: SourceText.New("", 'import X from "x";', "export const b: X;"),
                },
                {
                    name: bxIndex,
                    text: SourceText.New("", "", options ? options.bText : "export default class X { private x: number; }"),
                },
                {
                    name: bxPackage,
                    text: SourceText.New("", "", JSON.stringify({ name: "x", version: options ? options.bVersion : "1.2.3" })),
                },
                {
                    name: root,
                    text: SourceText.New("", 'import { a } from "a"; import { b } from "b";', "a(b)"),
                },
            ];

            return newProgram(files, [root], compilerOptions, useGetSourceFileByPath);
        }

        function updateRedirectProgram(program: ProgramWithSourceTexts, updater: (files: NamedSourceText[]) => void, useGetSourceFileByPath: boolean): ProgramWithSourceTexts {
            return updateProgram(program, [root], compilerOptions, updater, /*newTexts*/ undefined, useGetSourceFileByPath);
        }

        function runRedirectsBaseline(scenario: string, useGetSourceFileByPath: boolean, baselines: readonly string[]) {
            return runBaseline(`redirect${useGetSourceFileByPath ? " with getSourceFileByPath" : ""} ${scenario}`, baselines);
        }

        function verifyRedirects(useGetSourceFileByPath: boolean) {
            it("No changes -> redirect not broken", () => {
                const program1 = createRedirectProgram(useGetSourceFileByPath);
                const baselines: string[] = [];
                baselineProgram(baselines, program1);

                const program2 = updateRedirectProgram(program1, files => {
                    updateProgramText(files, root, "const x = 1;");
                }, useGetSourceFileByPath);
                baselineProgram(baselines, program2);
                runRedirectsBaseline("no change", useGetSourceFileByPath, baselines);
            });

            it("Target changes -> redirect broken", () => {
                const program1 = createRedirectProgram(useGetSourceFileByPath);
                const baselines: string[] = [];
                baselineProgram(baselines, program1);

                const program2 = updateRedirectProgram(program1, files => {
                    updateProgramText(files, axIndex, "export default class X { private x: number; private y: number; }");
                    updateProgramText(files, axPackage, JSON.stringify('{ name: "x", version: "1.2.4" }'));
                }, useGetSourceFileByPath);
                baselineProgram(baselines, program2);
                runRedirectsBaseline("target changes", useGetSourceFileByPath, baselines);
            });

            it("Underlying changes -> redirect broken", () => {
                const program1 = createRedirectProgram(useGetSourceFileByPath);
                const baselines: string[] = [];
                baselineProgram(baselines, program1);

                const program2 = updateRedirectProgram(program1, files => {
                    updateProgramText(files, bxIndex, "export default class X { private x: number; private y: number; }");
                    updateProgramText(files, bxPackage, JSON.stringify({ name: "x", version: "1.2.4" }));
                }, useGetSourceFileByPath);
                baselineProgram(baselines, program2);
                runRedirectsBaseline("underlying changes", useGetSourceFileByPath, baselines);
            });

            it("Previously duplicate packages -> program structure not reused", () => {
                const program1 = createRedirectProgram(useGetSourceFileByPath, { bVersion: "1.2.4", bText: "export = class X { private x: number; }" });
                const baselines: string[] = [];
                baselineProgram(baselines, program1);

                const program2 = updateRedirectProgram(program1, files => {
                    updateProgramText(files, bxIndex, "export default class X { private x: number; }");
                    updateProgramText(files, bxPackage, JSON.stringify({ name: "x", version: "1.2.3" }));
                }, useGetSourceFileByPath);
                baselineProgram(baselines, program2);
                runRedirectsBaseline(`previous duplicate packages`, useGetSourceFileByPath, baselines);
            });
        }

        describe("when host implements getSourceFile", () => {
            verifyRedirects(/*useGetSourceFileByPath*/ false);
        });
        describe("when host implements getSourceFileByPath", () => {
            verifyRedirects(/*useGetSourceFileByPath*/ true);
        });
    });
});

describe("unittests:: Reuse program structure:: host is optional", () => {
    it("should work if host is not provided", () => {
        ts.createProgram([], {});
    });
});


describe("unittests:: Reuse program structure:: isProgramUptoDate", () => {
    function getWhetherProgramIsUptoDate(
        program: ts.Program,
        newRootFileNames: string[],
        newOptions: ts.CompilerOptions
    ) {
        return ts.isProgramUptoDate(
            program, newRootFileNames, newOptions,
            path => program.getSourceFileByPath(path)!.version, /*fileExists*/ ts.returnFalse,
            /*hasInvalidatedResolutions*/ ts.returnFalse,
            /*hasChangedAutomaticTypeDirectiveNames*/ undefined,
            /*getParsedCommandLine*/ ts.returnUndefined,
            /*projectReferences*/ undefined
        );
    }

    function duplicate(options: ts.CompilerOptions): ts.CompilerOptions;
    function duplicate(fileNames: string[]): string[];
    function duplicate(filesOrOptions: ts.CompilerOptions | string[]) {
        return JSON.parse(JSON.stringify(filesOrOptions));
    }

    describe("should return true when there is no change in compiler options and", () => {
        function verifyProgramIsUptoDate(
            program: ts.Program,
            newRootFileNames: string[],
            newOptions: ts.CompilerOptions
        ) {
            const actual = getWhetherProgramIsUptoDate(program, newRootFileNames, newOptions);
            assert.isTrue(actual);
        }

        function verifyProgramWithoutConfigFile(system: ts.System, rootFiles: string[], options: ts.CompilerOptions) {
            const program = ts.createWatchProgram(ts.createWatchCompilerHostOfFilesAndCompilerOptions({
                rootFiles,
                options,
                watchOptions: undefined,
                system
            })).getCurrentProgram().getProgram();
            verifyProgramIsUptoDate(program, duplicate(rootFiles), duplicate(options));
        }

        function verifyProgramWithConfigFile(system: ts.System, configFileName: string) {
            const program = ts.createWatchProgram(ts.createWatchCompilerHostOfConfigFile({
                configFileName,
                system
            })).getCurrentProgram().getProgram();
            const { fileNames, options } = ts.parseConfigFileWithSystem(configFileName, {}, /*extendedConfigCache*/ undefined, /*watchOptionsToExtend*/ undefined, system, ts.notImplemented)!; // TODO: GH#18217
            verifyProgramIsUptoDate(program, fileNames, options);
        }

        function verifyProgram(files: File[], rootFiles: string[], options: ts.CompilerOptions, configFile: string) {
            const system = createWatchedSystem(files);
            verifyProgramWithoutConfigFile(system, rootFiles, options);
            verifyProgramWithConfigFile(system, configFile);
        }

        it("has empty options", () => {
            const file1: File = {
                path: "/a/b/file1.ts",
                content: "let x = 1"
            };
            const file2: File = {
                path: "/a/b/file2.ts",
                content: "let y = 1"
            };
            const configFile: File = {
                path: "/a/b/tsconfig.json",
                content: "{}"
            };
            verifyProgram([file1, file2, libFile, configFile], [file1.path, file2.path], {}, configFile.path);
        });

        it("has lib specified in the options", () => {
            const compilerOptions: ts.CompilerOptions = { lib: ["es5", "es2015.promise"] };
            const app: File = {
                path: "/src/app.ts",
                content: "var x: Promise<string>;"
            };
            const configFile: File = {
                path: "/src/tsconfig.json",
                content: JSON.stringify({ compilerOptions })
            };
            const es5Lib: File = {
                path: "/compiler/lib.es5.d.ts",
                content: "declare const eval: any"
            };
            const es2015Promise: File = {
                path: "/compiler/lib.es2015.promise.d.ts",
                content: "declare class Promise<T> {}"
            };

            verifyProgram([app, configFile, es5Lib, es2015Promise], [app.path], compilerOptions, configFile.path);
        });

        it("has paths specified in the options", () => {
            const compilerOptions: ts.CompilerOptions = {
                baseUrl: ".",
                paths: {
                    "*": [
                        "packages/mail/data/*",
                        "packages/styles/*",
                        "*"
                    ]
                }
            };
            const app: File = {
                path: "/src/packages/framework/app.ts",
                content: 'import classc from "module1/lib/file1";\
                              import classD from "module3/file3";\
                              let x = new classc();\
                              let y = new classD();'
            };
            const module1: File = {
                path: "/src/packages/mail/data/module1/lib/file1.ts",
                content: 'import classc from "module2/file2";export default classc;',
            };
            const module2: File = {
                path: "/src/packages/mail/data/module1/lib/module2/file2.ts",
                content: 'class classc { method2() { return "hello"; } }\nexport default classc',
            };
            const module3: File = {
                path: "/src/packages/styles/module3/file3.ts",
                content: "class classD { method() { return 10; } }\nexport default classD;"
            };
            const configFile: File = {
                path: "/src/tsconfig.json",
                content: JSON.stringify({ compilerOptions })
            };

            verifyProgram([app, module1, module2, module3, libFile, configFile], [app.path], compilerOptions, configFile.path);
        });

        it("has include paths specified in tsconfig file", () => {
            const compilerOptions: ts.CompilerOptions = {
                baseUrl: ".",
                paths: {
                    "*": [
                        "packages/mail/data/*",
                        "packages/styles/*",
                        "*"
                    ]
                }
            };
            const app: File = {
                path: "/src/packages/framework/app.ts",
                content: 'import classc from "module1/lib/file1";\
                              import classD from "module3/file3";\
                              let x = new classc();\
                              let y = new classD();'
            };
            const module1: File = {
                path: "/src/packages/mail/data/module1/lib/file1.ts",
                content: 'import classc from "module2/file2";export default classc;',
            };
            const module2: File = {
                path: "/src/packages/mail/data/module1/lib/module2/file2.ts",
                content: 'class classc { method2() { return "hello"; } }\nexport default classc',
            };
            const module3: File = {
                path: "/src/packages/styles/module3/file3.ts",
                content: "class classD { method() { return 10; } }\nexport default classD;"
            };
            const configFile: File = {
                path: "/src/tsconfig.json",
                content: JSON.stringify({ compilerOptions, include: ["packages/**/*.ts"] })
            };
            verifyProgramWithConfigFile(createWatchedSystem([app, module1, module2, module3, libFile, configFile]), configFile.path);
        });
        it("has the same root file names", () => {
            const module1: File = {
                path: "/src/packages/mail/data/module1/lib/file1.ts",
                content: 'import classc from "module2/file2";export default classc;',
            };
            const module2: File = {
                path: "/src/packages/mail/data/module1/lib/module2/file2.ts",
                content: 'class classc { method2() { return "hello"; } }\nexport default classc',
            };
            const module3: File = {
                path: "/src/packages/styles/module3/file3.ts",
                content: "class classD { method() { return 10; } }\nexport default classD;"
            };
            const rootFiles = [module1.path, module2.path, module3.path];
            const system = createWatchedSystem([module1, module2, module3]);
            const options = {};
            const program = ts.createWatchProgram(ts.createWatchCompilerHostOfFilesAndCompilerOptions({
                rootFiles,
                options,
                watchOptions: undefined,
                system
            })).getCurrentProgram().getProgram();
            verifyProgramIsUptoDate(program, duplicate(rootFiles), duplicate(options));
        });

    });
    describe("should return false when there is no change in compiler options but", () => {
        function verifyProgramIsNotUptoDate(
            program: ts.Program,
            newRootFileNames: string[],
            newOptions: ts.CompilerOptions
        ) {
            const actual = getWhetherProgramIsUptoDate(program, newRootFileNames, newOptions);
            assert.isFalse(actual);
        }
        it("has more root file names", () => {
            const module1: File = {
                path: "/src/packages/mail/data/module1/lib/file1.ts",
                content: 'import classc from "module2/file2";export default classc;',
            };
            const module2: File = {
                path: "/src/packages/mail/data/module1/lib/module2/file2.ts",
                content: 'class classc { method2() { return "hello"; } }\nexport default classc',
            };
            const module3: File = {
                path: "/src/packages/styles/module3/file3.ts",
                content: "class classD { method() { return 10; } }\nexport default classD;"
            };
            const rootFiles = [module1.path, module2.path];
            const newRootFiles = [module1.path, module2.path, module3.path];
            const system = createWatchedSystem([module1, module2, module3]);
            const options = {};
            const program = ts.createWatchProgram(ts.createWatchCompilerHostOfFilesAndCompilerOptions({
                rootFiles,
                options,
                watchOptions: undefined,
                system
            })).getCurrentProgram().getProgram();
            verifyProgramIsNotUptoDate(program, duplicate(newRootFiles), duplicate(options));
        });
        it("has one root file replaced by another", () => {
            const module1: File = {
                path: "/src/packages/mail/data/module1/lib/file1.ts",
                content: 'import classc from "module2/file2";export default classc;',
            };
            const module2: File = {
                path: "/src/packages/mail/data/module1/lib/module2/file2.ts",
                content: 'class classc { method2() { return "hello"; } }\nexport default classc',
            };
            const module3: File = {
                path: "/src/packages/styles/module3/file3.ts",
                content: "class classD { method() { return 10; } }\nexport default classD;"
            };
            const rootFiles = [module1.path, module2.path];
            const newRootFiles = [module2.path, module3.path];
            const system = createWatchedSystem([module1, module2, module3]);
            const options = {};
            const program = ts.createWatchProgram(ts.createWatchCompilerHostOfFilesAndCompilerOptions({
                rootFiles,
                options,
                watchOptions: undefined,
                system
            })).getCurrentProgram().getProgram();
            verifyProgramIsNotUptoDate(program, duplicate(newRootFiles), duplicate(options));
        });
    });
});
