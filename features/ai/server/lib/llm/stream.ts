import type { LlmStreamEvent } from "#layers/ai/shared/llm";
import { failure } from "#layers/ai/server/lib/errors";
import { SSEProcessor } from "#layers/ai/server/lib/sse";
import { sanitize } from "#layers/ai/server/lib/text";

export interface EventTranslator {
  // A provider event can yield several model events. Provider failures throw
  event: (data: unknown) => LlmStreamEvent[];
  // A null result marks an incomplete stream
  end: () => LlmStreamEvent[] | null;
}

export const translateEventStream = (
  stream: ReadableStream<Uint8Array>,
  translator: EventTranslator,
): ReadableStream<LlmStreamEvent> => {
  const pendingEvents: string[] = [];
  const sseProcessor = new SSEProcessor({ onEvent: (event) => pendingEvents.push(event.data) });

  const translateEvents = (controller: TransformStreamDefaultController<LlmStreamEvent>): void => {
    for (const data of pendingEvents.splice(0)) {
      let rawEvent: unknown;
      try {
        rawEvent = sanitize(JSON.parse(data));
      } catch {
        continue;
      }
      for (const event of translator.event(rawEvent)) {
        controller.enqueue(event);
      }
    }
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, LlmStreamEvent>({
      transform(bytes, controller) {
        sseProcessor.process(bytes);
        translateEvents(controller);
      },
      flush(controller) {
        sseProcessor.flush();
        translateEvents(controller);
        const events = translator.end();
        if (!events) {
          throw failure("the answer ended before it was complete");
        }
        for (const event of events) {
          controller.enqueue(event);
        }
      },
    }),
  );
};
