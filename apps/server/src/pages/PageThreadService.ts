import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  CommandId,
  MessageId,
  type PageAskInThreadInput,
  type PageAskInThreadResult,
  PageError,
  type PageNotFoundError,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  pageContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PageService from "./PageService.ts";

/** Starts an agent thread about a page: the prompt plus the page as a context record. */
export class PageThreadService extends Context.Service<
  PageThreadService,
  {
    readonly askInThread: (
      input: PageAskInThreadInput,
    ) => Effect.Effect<PageAskInThreadResult, PageNotFoundError | PageError>;
  }
>()("t3/pages/PageThreadService") {}

const make = Effect.gen(function* () {
  const pages = yield* PageService.PageService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const settings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  // No attachments ride on these messages, so the launch service is used directly.
  const launches = yield* ThreadLaunch.ThreadLaunchService;

  const fail = (message: string) => (cause: unknown) => new PageError({ message, cause });

  const askInThread = Effect.fn("PageThreadService.askInThread")(function* (
    input: PageAskInThreadInput,
  ) {
    const page = yield* pages.get(input.id);
    const record = pageContextRecord(page);
    // Page threads start in the scratch project, as chats without a project do.
    const { projectId } = yield* folders.ensureScratchProject.pipe(
      Effect.mapError(fail("Could not prepare a folder for the thread.")),
    );
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(fail("Could not read settings.")),
    );
    const modelSelection =
      input.modelSelection ??
      resolveNewThreadModelSelection({
        defaultSelection: current.defaultModelSelection,
        fallbackSelection: current.fallbackModelSelection,
        providers: yield* providers.getProviders,
        settings: current,
        projectId,
        now: DateTime.toEpochMillis(yield* DateTime.now),
      }).selection;
    if (modelSelection === null)
      return yield* new PageError({
        message: "Choose a default model for new threads in Settings first.",
      });
    const uuid = yield* random.uuidV4().pipe(Effect.mapError(fail("Could not create the thread.")));
    const result = yield* launches
      .launch({
        commandId: CommandId.make(`page-thread:${uuid}`),
        projectId,
        title: record.title,
        generateTitle: true,
        modelSelection,
        runtimeMode: current.defaultRuntimeMode,
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        initialMessage: {
          messageId: MessageId.make(`page-message:${uuid}`),
          text: `${input.prompt}\n\n${formatComposerContextReference(record)}`,
          attachments: [],
          context: { version: 1, records: [record] },
        },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(fail("Could not start the thread.")));
    return { threadId: result.projection.thread.id };
  });

  return PageThreadService.of({ askInThread });
});

export const layer = Layer.effect(PageThreadService, make);
