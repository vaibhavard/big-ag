import * as React from 'react';
import { shallow } from 'zustand/shallow';
import { fileOpen, FileWithHandle } from 'browser-fs-access';
import { keyframes } from '@emotion/react';

import { Box, Button, ButtonGroup, Card, Dropdown, Grid, IconButton, Menu, MenuButton, MenuItem, Textarea, Tooltip, Typography } from '@mui/joy';
import { ColorPaletteProp, SxProps, VariantProp } from '@mui/joy/styles/types';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SendIcon from '@mui/icons-material/Send';
import StopOutlinedIcon from '@mui/icons-material/StopOutlined';
import TelegramIcon from '@mui/icons-material/Telegram';

import type { ChatModeId } from '../../AppChat';
import { useChatMicTimeoutMsValue } from '../../store-app-chat';

import type { DLLM } from '~/modules/llms/store-llms';
import type { LLMOptionsOpenAI } from '~/modules/llms/vendors/openai/openai.vendor';
import { useBrowseCapability } from '~/modules/browse/store-module-browsing';

import { ChatBeamIcon } from '~/common/components/icons/ChatBeamIcon';
import { DConversationId, useChatStore } from '~/common/state/store-chats';
import { PreferencesTab, useOptimaLayout } from '~/common/layout/optima/useOptimaLayout';
import { SpeechResult, useSpeechRecognition } from '~/common/components/useSpeechRecognition';
import { countModelTokens } from '~/common/util/token-counter';
import { launchAppCall } from '~/common/app.routes';
import { lineHeightTextareaMd } from '~/common/app.theme';
import { playSoundUrl } from '~/common/util/audioUtils';
import { supportsClipboardRead } from '~/common/util/clipboardUtils';
import { supportsScreenCapture } from '~/common/util/screenCaptureUtils';
import { useDebouncer } from '~/common/components/useDebouncer';
import { useGlobalShortcut } from '~/common/components/useGlobalShortcut';
import { useUICounter, useUIPreferencesStore } from '~/common/state/store-ui';
import { useUXLabsStore } from '~/common/state/store-ux-labs';

import type { ActileItem, ActileProvider } from './actile/ActileProvider';
import { providerCommands } from './actile/providerCommands';
import { useActileManager } from './actile/useActileManager';

import type { AttachmentId } from './attachments/store-attachments';
import { Attachments } from './attachments/Attachments';
import { getTextBlockText, useLLMAttachments } from './attachments/useLLMAttachments';
import { useAttachments } from './attachments/useAttachments';

import type { ComposerOutputMultiPart } from './composer.types';
import { ButtonAttachCameraMemo, useCameraCaptureModal } from './buttons/ButtonAttachCamera';
import { ButtonAttachClipboardMemo } from './buttons/ButtonAttachClipboard';
import { ButtonAttachFileMemo } from './buttons/ButtonAttachFile';
import { ButtonAttachScreenCaptureMemo } from './buttons/ButtonAttachScreenCapture';
import { ButtonCallMemo } from './buttons/ButtonCall';
import { ButtonMicContinuationMemo } from './buttons/ButtonMicContinuation';
import { ButtonMicMemo } from './buttons/ButtonMic';
import { ButtonMultiChatMemo } from './buttons/ButtonMultiChat';
import { ButtonOptionsDraw } from './buttons/ButtonOptionsDraw';
import { ChatModeMenu } from './ChatModeMenu';
import { TokenBadgeMemo } from './TokenBadge';
import { TokenProgressbarMemo } from './TokenProgressbar';
import { useComposerStartupText } from './store-composer';


export const animationStopEnter = keyframes`
    from {
        opacity: 0;
        transform: translateY(8px)
    }
    to {
        opacity: 1;
        transform: translateY(0)
    }
`;

const dropperCardSx: SxProps = {
  display: 'none',
  position: 'absolute', bottom: 0, left: 0, right: 0, top: 0,
  alignItems: 'center', justifyContent: 'center', gap: 2,
  border: '2px dashed',
  borderRadius: 'xs',
  boxShadow: 'none',
  zIndex: 10,
} as const;

const dropppedCardDraggingSx: SxProps = {
  ...dropperCardSx,
  display: 'flex',
} as const;


/**
 * A React component for composing messages, with attachments and different modes.
 */
export function Composer(props: {
  isMobile?: boolean;
  chatLLM: DLLM | null;
  composerTextAreaRef: React.RefObject<HTMLTextAreaElement>;
  conversationId: DConversationId | null;
  capabilityHasT2I: boolean;
  isMulticast: boolean | null;
  isDeveloperMode: boolean;
  onAction: (chatModeId: ChatModeId, conversationId: DConversationId, multiPartMessage: ComposerOutputMultiPart) => boolean;
  onTextImagine: (conversationId: DConversationId, text: string) => void;
  setIsMulticast: (on: boolean) => void;
  sx?: SxProps;
}) {

  // state
  const [composeText, debouncedText, setComposeText] = useDebouncer('', 300, 1200, true);
  const [micContinuation, setMicContinuation] = React.useState(false);
  const [speechInterimResult, setSpeechInterimResult] = React.useState<SpeechResult | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [chatModeMenuAnchor, setChatModeMenuAnchor] = React.useState<HTMLAnchorElement | null>(null);

  // external state
  const { openPreferencesTab /*, setIsFocusedMode*/ } = useOptimaLayout();
  const { labsAttachScreenCapture, labsCameraDesktop } = useUXLabsStore(state => ({
    labsAttachScreenCapture: state.labsAttachScreenCapture,
    labsCameraDesktop: state.labsCameraDesktop,
  }), shallow);
  const { novel: explainShiftEnter, touch: touchShiftEnter } = useUICounter('composer-shift-enter');
  const [chatModeId, setChatModeId] = React.useState<ChatModeId>('generate-text');
  const [startupText, setStartupText] = useComposerStartupText();
  const enterIsNewline = useUIPreferencesStore(state => state.enterIsNewline);
  const chatMicTimeoutMs = useChatMicTimeoutMsValue();
  const { assistantAbortible, systemPurposeId, tokenCount: _historyTokenCount, stopTyping } = useChatStore(state => {
    const conversation = state.conversations.find(_c => _c.id === props.conversationId);
    return {
      assistantAbortible: conversation ? !!conversation.abortController : false,
      systemPurposeId: conversation?.systemPurposeId ?? null,
      tokenCount: conversation ? conversation.tokenCount : 0,
      stopTyping: state.stopTyping,
    };
  }, shallow);
  const { inComposer: browsingInComposer } = useBrowseCapability();
  const { attachAppendClipboardItems, attachAppendDataTransfer, attachAppendFile, attachments: _attachments, clearAttachments, removeAttachment } =
    useAttachments(browsingInComposer && !composeText.startsWith('/'));


  // derived state

  const isMobile = !!props.isMobile;
  const isDesktop = !props.isMobile;
  const chatLLMId = props.chatLLM?.id || null;

  // attachments derived state

  const llmAttachments = useLLMAttachments(_attachments, chatLLMId);

  // tokens derived state

  const tokensComposerText = React.useMemo(() => {
    if (!debouncedText || !chatLLMId)
      return 0;
    return countModelTokens(debouncedText, chatLLMId, 'composer text') ?? 0;
  }, [chatLLMId, debouncedText]);
  let tokensComposer = tokensComposerText + llmAttachments.tokenCountApprox;
  if (tokensComposer > 0)
    tokensComposer += 4; // every user message has this many surrounding tokens (note: shall depend on llm..)
  const tokensHistory = _historyTokenCount;
  const tokensReponseMax = (props.chatLLM?.options as LLMOptionsOpenAI /* FIXME: BIG ASSUMPTION */)?.llmResponseTokens || 0;
  const tokenLimit = props.chatLLM?.contextTokens || 0;


  // Effect: load initial text if queued up (e.g. by /link/share_targe)
  React.useEffect(() => {
    if (startupText) {
      setStartupText(null);
      setComposeText(startupText);
    }
  }, [setComposeText, setStartupText, startupText]);


  // Primary button

  const { conversationId, onAction } = props;

  const handleSendAction = React.useCallback((_chatModeId: ChatModeId, composerText: string): boolean => {
    if (!conversationId)
      return false;

    // get attachments
    const multiPartMessage = llmAttachments.getAttachmentsOutputs(composerText || null);
    if (!multiPartMessage.length)
      return false;

    // send the message
    const enqueued = onAction(_chatModeId, conversationId, multiPartMessage);
    if (enqueued) {
      clearAttachments();
      setComposeText('');
    }

    return enqueued;
  }, [clearAttachments, conversationId, llmAttachments, onAction, setComposeText]);

  const handleSendClicked = React.useCallback(() => {
    handleSendAction(chatModeId, composeText);
  }, [chatModeId, composeText, handleSendAction]);

  const handleStopClicked = React.useCallback(() => {
    !!props.conversationId && stopTyping(props.conversationId);
  }, [props.conversationId, stopTyping]);


  // Secondary buttons

  const handleCallClicked = React.useCallback(() => {
    props.conversationId && systemPurposeId && launchAppCall(props.conversationId, systemPurposeId);
  }, [props.conversationId, systemPurposeId]);

  const handleDrawOptionsClicked = React.useCallback(() => {
    openPreferencesTab(PreferencesTab.Draw);
  }, [openPreferencesTab]);

  const handleTextImagineClicked = React.useCallback(() => {
    if (!composeText || !props.conversationId)
      return;
    props.onTextImagine(props.conversationId, composeText);
    setComposeText('');
  }, [composeText, props, setComposeText]);


  // Mode menu

  const handleModeSelectorHide = React.useCallback(() => {
    setChatModeMenuAnchor(null);
  }, []);

  const handleModeSelectorShow = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    setChatModeMenuAnchor(anchor => anchor ? null : event.currentTarget);
  }, []);

  const handleModeChange = React.useCallback((_chatModeId: ChatModeId) => {
    handleModeSelectorHide();
    setChatModeId(_chatModeId);
  }, [handleModeSelectorHide]);


  // Actiles

  const onActileCommandSelect = React.useCallback((item: ActileItem) => {
    if (props.composerTextAreaRef.current) {
      const textArea = props.composerTextAreaRef.current;
      const currentText = textArea.value;
      const cursorPos = textArea.selectionStart;

      // Find the position where the command starts
      const commandStart = currentText.lastIndexOf('/', cursorPos);

      // Construct the new text with the autocompleted command
      const newText = currentText.substring(0, commandStart) + item.label + ' ' + currentText.substring(cursorPos);

      // Update the text area with the new text
      setComposeText(newText);

      // Move the cursor to the end of the autocompleted command
      const newCursorPos = commandStart + item.label.length + 1;
      textArea.setSelectionRange(newCursorPos, newCursorPos);
    }
  }, [props.composerTextAreaRef, setComposeText]);

  const actileProviders: ActileProvider[] = React.useMemo(() => {
    return [providerCommands(onActileCommandSelect)];
  }, [onActileCommandSelect]);

  const { actileComponent, actileInterceptKeydown, actileInterceptTextChange } = useActileManager(actileProviders, props.composerTextAreaRef);


  // Text typing

  const handleTextareaTextChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposeText(e.target.value);
    isMobile && actileInterceptTextChange(e.target.value);
  }, [actileInterceptTextChange, isMobile, setComposeText]);

  const handleTextareaKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // disable keyboard handling if the actile is visible
    if (actileInterceptKeydown(e))
      return;

    // Enter: primary action
    if (e.key === 'Enter') {

      // Alt: append the message instead
      if (e.altKey) {
        handleSendAction('append-user', composeText);
        return e.preventDefault();
      }

      // Shift: toggles the 'enter is newline'
      if (e.shiftKey)
        touchShiftEnter();
      if (enterIsNewline ? e.shiftKey : !e.shiftKey) {
        if (!assistantAbortible)
          handleSendAction(chatModeId, composeText);
        return e.preventDefault();
      }
    }

  }, [actileInterceptKeydown, assistantAbortible, chatModeId, composeText, enterIsNewline, handleSendAction, touchShiftEnter]);


  // Focus mode

  // const handleFocusModeOn = React.useCallback(() => setIsFocusedMode(true), [setIsFocusedMode]);

  // const handleFocusModeOff = React.useCallback(() => setIsFocusedMode(false), [setIsFocusedMode]);


  // Mic typing & continuation mode

  const onSpeechResultCallback = React.useCallback((result: SpeechResult) => {
    // not done: show interim
    if (!result.done) {
      setSpeechInterimResult({ ...result });
      return;
    }

    // done
    setSpeechInterimResult(null);
    const transcript = result.transcript.trim();
    let nextText = (composeText || '').trim();
    nextText = nextText ? nextText + ' ' + transcript : transcript;

    // auto-send (mic continuation mode) if requested
    const autoSend = micContinuation && nextText.length >= 1 && !!props.conversationId; //&& assistantAbortible;
    const notUserStop = result.doneReason !== 'manual';
    if (autoSend) {
      if (notUserStop)
        playSoundUrl('/sounds/mic-off-mid.mp3');
      handleSendAction(chatModeId, nextText);
    } else {
      if (!micContinuation && notUserStop)
        playSoundUrl('/sounds/mic-off-mid.mp3');
      if (nextText) {
        props.composerTextAreaRef.current?.focus();
        setComposeText(nextText);
      }
    }
  }, [chatModeId, composeText, handleSendAction, micContinuation, props.composerTextAreaRef, props.conversationId, setComposeText]);

  const { isSpeechEnabled, isSpeechError, isRecordingAudio, isRecordingSpeech, toggleRecording } =
    useSpeechRecognition(onSpeechResultCallback, chatMicTimeoutMs || 2000);

  useGlobalShortcut('m', true, false, false, toggleRecording);

  const micIsRunning = !!speechInterimResult;
  const micContinuationTrigger = micContinuation && !micIsRunning && !assistantAbortible && !isSpeechError;
  const micColor: ColorPaletteProp = isSpeechError ? 'danger' : isRecordingSpeech ? 'primary' : isRecordingAudio ? 'primary' : 'neutral';
  const micVariant: VariantProp = isRecordingSpeech ? 'solid' : isRecordingAudio ? 'soft' : 'soft';  //(isDesktop ? 'soft' : 'plain');

  const handleToggleMic = React.useCallback(() => {
    if (micIsRunning && micContinuation)
      setMicContinuation(false);
    toggleRecording();
  }, [micContinuation, micIsRunning, toggleRecording]);

  const handleToggleMicContinuation = React.useCallback(() => {
    setMicContinuation(continued => !continued);
  }, []);

  React.useEffect(() => {
    // autostart the microphone if the assistant stopped typing
    if (micContinuationTrigger)
      toggleRecording();
  }, [toggleRecording, micContinuationTrigger]);


  // Attachments

  const handleAttachCtrlV = React.useCallback((event: React.ClipboardEvent) => {
    if (attachAppendDataTransfer(event.clipboardData, 'paste', false) === 'as_files')
      event.preventDefault();
  }, [attachAppendDataTransfer]);

  const handleAttachCameraImage = React.useCallback((file: FileWithHandle) => {
    void attachAppendFile('camera', file);
  }, [attachAppendFile]);

  const handleAttachScreenCapture = React.useCallback((file: File) => {
    void attachAppendFile('screencapture', file);
  }, [attachAppendFile]);

  const { openCamera, cameraCaptureComponent } = useCameraCaptureModal(handleAttachCameraImage);

  const handleAttachFilePicker = React.useCallback(async () => {
    try {
      const selectedFiles: FileWithHandle[] = await fileOpen({ multiple: true });
      selectedFiles.forEach(file =>
        void attachAppendFile('file-open', file),
      );
    } catch (error) {
      // ignore...
    }
  }, [attachAppendFile]);

  useGlobalShortcut(supportsClipboardRead ? 'v' : false, true, true, false, attachAppendClipboardItems);

  const handleAttachmentInlineText = React.useCallback((attachmentId: AttachmentId) => {
    setComposeText(currentText => {
      const attachmentOutputs = llmAttachments.getAttachmentOutputs(currentText, attachmentId);
      const inlinedText = getTextBlockText(attachmentOutputs) || '';
      removeAttachment(attachmentId);
      return inlinedText;
    });
  }, [llmAttachments, removeAttachment, setComposeText]);

  const handleAttachmentsInlineText = React.useCallback(() => {
    setComposeText(currentText => {
      const attachmentsOutputs = llmAttachments.getAttachmentsOutputs(currentText);
      const inlinedText = getTextBlockText(attachmentsOutputs) || '';
      clearAttachments();
      return inlinedText;
    });
  }, [clearAttachments, llmAttachments, setComposeText]);


  // Drag & Drop

  const eatDragEvent = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleTextareaDragEnter = React.useCallback((e: React.DragEvent) => {
    const isFromSelf = e.dataTransfer.types.includes('x-app/agi');
    if (!isFromSelf) {
      eatDragEvent(e);
      setIsDragging(true);
    }
  }, [eatDragEvent]);

  const handleTextareaDragStart = React.useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('x-app/agi', 'do-not-intercept');
  }, []);

  const handleOverlayDragLeave = React.useCallback((e: React.DragEvent) => {
    eatDragEvent(e);
    setIsDragging(false);
  }, [eatDragEvent]);

  const handleOverlayDragOver = React.useCallback((e: React.DragEvent) => {
    eatDragEvent(e);
    // this makes sure we don't "transfer" (or move) the attachment, but we tell the sender we'll copy it
    e.dataTransfer.dropEffect = 'copy';
  }, [eatDragEvent]);

  const handleOverlayDrop = React.useCallback(async (event: React.DragEvent) => {
    eatDragEvent(event);
    setIsDragging(false);

    // VSCode: detect failure of dropping from VSCode, details below:
    //         https://github.com/microsoft/vscode/issues/98629#issuecomment-634475572
    const { dataTransfer } = event;
    if (dataTransfer.types.includes('codeeditors'))
      return setComposeText(test => test + 'Dragging files from VSCode is not supported! Fixme: anyone?');

    // textarea drop
    attachAppendDataTransfer(dataTransfer, 'drop', true);
  }, [attachAppendDataTransfer, eatDragEvent, setComposeText]);


  const isText = chatModeId === 'generate-text';
  const isTextBeam = chatModeId === 'generate-text-beam';
  const isAppend = chatModeId === 'append-user';
  const isReAct = chatModeId === 'generate-react';
  const isDraw = chatModeId === 'generate-image';

  const showCall = isText || isAppend;

  const buttonColor: ColorPaletteProp =
    assistantAbortible ? 'warning'
      : isReAct ? 'success'
        : isTextBeam ? 'success'
          : isDraw ? 'warning'
            : 'primary';

  const buttonText =
    isAppend ? 'Write'
      : isReAct ? 'ReAct'
        : isTextBeam ? 'Beam'
          : isDraw ? 'Draw'
            : 'Chat';

  const buttonIcon =
    micContinuation ? <AutoModeIcon />
      : isAppend ? <SendIcon sx={{ fontSize: 18 }} />
        : isReAct ? <PsychologyIcon />
          : isTextBeam ? <ChatBeamIcon /> /* <GavelIcon /> */
            : isDraw ? <FormatPaintIcon />
              : <TelegramIcon />;

  let textPlaceholder: string =
    isDraw ? 'Describe an idea or a drawing...'
      : isReAct ? 'Multi-step reasoning question...'
        : isTextBeam ? 'Multi-chat with this persona...'
          : props.isDeveloperMode ? 'Chat with me' + (isDesktop ? ' · drop source' : '') + ' · attach code...'
            : props.capabilityHasT2I ? 'Chat · /react · /draw · drop files...'
              : 'Chat · /react · drop files...';
  if (isDesktop && explainShiftEnter)
    textPlaceholder += !enterIsNewline ? '\nShift+Enter to add a new line' : '\nShift+Enter to send';

  return (
    <Box aria-label='User Message' component='section' sx={props.sx}>
      <Grid container spacing={{ xs: 1, md: 2 }}>

        <Grid xs={12} md={9}><Box sx={{ display: 'flex', gap: { xs: 1, md: 2 }, alignItems: 'flex-start' }}>

          {/* Start buttons column */}
          <Box sx={{
            flexGrow: 0,
            display: 'grid', gap: 1,
          }}>
            {isMobile ? <>

              {/* [mobile] Mic button */}
              {isSpeechEnabled && <ButtonMicMemo variant={micVariant} color={micColor} onClick={handleToggleMic} />}

              {/* [mobile] [+] button */}
              <Dropdown>
                <MenuButton slots={{ root: IconButton }}>
                  <AddCircleOutlineIcon />
                </MenuButton>
                <Menu>
                  {/* Responsive Camera OCR button */}
                  <MenuItem>
                    <ButtonAttachCameraMemo onOpenCamera={openCamera} />
                  </MenuItem>

                  {/* Responsive Open Files button */}
                  <MenuItem>
                    <ButtonAttachFileMemo onAttachFilePicker={handleAttachFilePicker} />
                  </MenuItem>

                  {/* Responsive Paste button */}
                  {supportsClipboardRead && <MenuItem>
                    <ButtonAttachClipboardMemo onClick={attachAppendClipboardItems} />
                  </MenuItem>}
                </Menu>
              </Dropdown>

              {/* [Mobile] MultiChat button */}
              {props.isMulticast !== null && <ButtonMultiChatMemo isMobile multiChat={props.isMulticast} onSetMultiChat={props.setIsMulticast} />}

            </> : <>

              {/*<FormHelperText sx={{ mx: 'auto' }}>*/}
              {/*  Attach*/}
              {/*</FormHelperText>*/}

              {/* Responsive Open Files button */}
              <ButtonAttachFileMemo onAttachFilePicker={handleAttachFilePicker} />

              {/* Responsive Paste button */}
              {supportsClipboardRead && <ButtonAttachClipboardMemo onClick={attachAppendClipboardItems} />}

              {/* Responsive Screen Capture button */}
              {labsAttachScreenCapture && supportsScreenCapture && <ButtonAttachScreenCaptureMemo onAttachScreenCapture={handleAttachScreenCapture} />}

              {/* Responsive Camera OCR button */}
              {labsCameraDesktop && <ButtonAttachCameraMemo onOpenCamera={openCamera} />}

            </>}
          </Box>

          {/* [ Textarea + Overlays + Mic | Attachments ] */}
          <Box sx={{
            flexGrow: 1,
            // layout
            display: 'flex', flexDirection: 'column', gap: 1,
            minWidth: 200, // flex: enable X-scrolling (resetting any possible minWidth due to the attachments)
          }}>

            {/* Textarea + Mic buttons + Mic/Drag overlay */}
            <Box sx={{ position: 'relative' }}>

              {/* Edit box with inner Token Progress bar */}
              <Box sx={{ position: 'relative' }}>

                <Textarea
                  variant='outlined'
                  color={isDraw ? 'warning' : isReAct ? 'success' : undefined}
                  autoFocus
                  minRows={isMobile ? 4 : 5}
                  maxRows={isMobile ? 8 : 10}
                  placeholder={textPlaceholder}
                  value={composeText}
                  onChange={handleTextareaTextChange}
                  onDragEnter={handleTextareaDragEnter}
                  onDragStart={handleTextareaDragStart}
                  onKeyDown={handleTextareaKeyDown}
                  onPasteCapture={handleAttachCtrlV}
                  // onFocusCapture={handleFocusModeOn}
                  // onBlurCapture={handleFocusModeOff}
                  slotProps={{
                    textarea: {
                      enterKeyHint: enterIsNewline ? 'enter' : 'send',
                      sx: {
                        ...(isSpeechEnabled && { pr: { md: 5 } }),
                        // mb: 0.5, // no need; the outer container already has enough p (for TokenProgressbar)
                      },
                      ref: props.composerTextAreaRef,
                    },
                  }}
                  sx={{
                    backgroundColor: 'background.level1',
                    '&:focus-within': { backgroundColor: 'background.popup' },
                    lineHeight: lineHeightTextareaMd,
                  }} />

                {tokenLimit > 0 && (tokensComposer > 0 || (tokensHistory + tokensReponseMax) > 0) && (
                  <TokenProgressbarMemo direct={tokensComposer} history={tokensHistory} responseMax={tokensReponseMax} limit={tokenLimit} />
                )}

                {!!tokenLimit && (
                  <TokenBadgeMemo direct={tokensComposer} history={tokensHistory} responseMax={tokensReponseMax} limit={tokenLimit} showExcess absoluteBottomRight />
                )}

              </Box>

              {/* Mic & Mic Continuation Buttons */}
              {isSpeechEnabled && (
                <Box sx={{
                  position: 'absolute', top: 0, right: 0,
                  zIndex: 21,
                  mt: isDesktop ? 1 : 0.25,
                  mr: isDesktop ? 1 : 0.25,
                  display: 'flex', flexDirection: 'column', gap: isDesktop ? 1 : 0.25,
                }}>
                  {isDesktop && <ButtonMicMemo variant={micVariant} color={micColor} onClick={handleToggleMic} noBackground={!isRecordingSpeech} />}

                  {micIsRunning && (
                    <ButtonMicContinuationMemo
                      variant={micContinuation ? 'solid' : 'soft'} color={micContinuation ? 'primary' : 'neutral'} sx={{ background: micContinuation ? undefined : 'none' }}
                      onClick={handleToggleMicContinuation}
                    />
                  )}
                </Box>
              )}

              {/* overlay: Mic */}
              {micIsRunning && (
                <Card
                  color='primary' variant='soft' invertedColors
                  sx={{
                    display: 'flex',
                    position: 'absolute', bottom: 0, left: 0, right: 0, top: 0,
                    // alignItems: 'center', justifyContent: 'center',
                    border: '1px solid',
                    borderColor: 'primary.solidBg',
                    borderRadius: 'sm',
                    zIndex: 20,
                    px: 1.5, py: 1,
                  }}>
                  <Typography>
                    {speechInterimResult.transcript}{' '}
                    <span style={{ opacity: 0.8 }}>{speechInterimResult.interimTranscript}</span>
                  </Typography>
                </Card>
              )}

              {/* overlay: Drag & Drop*/}
              {!isMobile && (
                <Card
                  color={isDragging ? 'success' : undefined} variant={isDragging ? 'soft' : undefined} invertedColors={isDragging}
                  sx={isDragging ? dropppedCardDraggingSx : dropperCardSx}
                  onDragLeave={handleOverlayDragLeave}
                  onDragOver={handleOverlayDragOver}
                  onDrop={handleOverlayDrop}
                >
                  {isDragging && <AttachFileIcon sx={{ width: 40, height: 40, pointerEvents: 'none' }} />}
                  {isDragging && <Typography level='title-sm' sx={{ pointerEvents: 'none' }}>
                    I will hold on to this for you
                  </Typography>}
                </Card>
              )}

            </Box>

            {/* Render any Attachments & menu items */}
            <Attachments
              llmAttachments={llmAttachments}
              onAttachmentInlineText={handleAttachmentInlineText}
              onAttachmentsClear={clearAttachments}
              onAttachmentsInlineText={handleAttachmentsInlineText}
            />

          </Box>

        </Box></Grid>


        <Grid xs={12} md={3}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%' } as const}>

            {/* This row is here only for the [mobile] bottom-start corner item */}
            <Box sx={{ display: 'flex' }}>

              {/* [mobile] bottom-corner secondary button */}
              {isMobile && (showCall
                  ? <ButtonCallMemo isMobile disabled={!props.conversationId || !chatLLMId} onClick={handleCallClicked} />
                  : isDraw
                    ? <ButtonOptionsDraw isMobile onClick={handleDrawOptionsClicked} sx={{ mr: { xs: 1, md: 2 } }} />
                    : <IconButton disabled sx={{ mr: { xs: 1, md: 2 } }} />
              )}

              {/* Responsive Send/Stop buttons */}
              <ButtonGroup
                variant={isAppend ? 'outlined' : 'solid'}
                color={buttonColor}
                sx={{
                  flexGrow: 1,
                  boxShadow: isMobile ? 'none' : `0 8px 24px -4px rgb(var(--joy-palette-${buttonColor}-mainChannel) / 20%)`,
                }}
              >
                {!assistantAbortible ? (
                  <Button
                    key='composer-act'
                    fullWidth disabled={!props.conversationId || !chatLLMId || !llmAttachments.isOutputAttacheable}
                    onClick={handleSendClicked}
                    endDecorator={buttonIcon}
                    sx={{ '--Button-gap': '1rem' }}
                  >
                    {micContinuation && 'Voice '}{buttonText}
                  </Button>
                ) : (
                  <Button
                    key='composer-stop'
                    fullWidth variant='soft' disabled={!props.conversationId}
                    onClick={handleStopClicked}
                    endDecorator={<StopOutlinedIcon sx={{ fontSize: 18 }} />}
                    sx={{ animation: `${animationStopEnter} 0.1s ease-out` }}
                  >
                    Stop
                  </Button>
                )}

                {/* [Draw] Imagine */}
                {isDraw && !!composeText && <Tooltip title='Imagine a drawing prompt'>
                  <IconButton variant='outlined' disabled={!props.conversationId || !chatLLMId} onClick={handleTextImagineClicked}>
                    <AutoAwesomeIcon />
                  </IconButton>
                </Tooltip>}

                {/* Mode expander */}
                <IconButton
                  variant={assistantAbortible ? 'soft' : isDraw ? undefined : undefined}
                  disabled={!props.conversationId || !chatLLMId || !!chatModeMenuAnchor}
                  onClick={handleModeSelectorShow}
                >
                  <ExpandLessIcon />
                </IconButton>
              </ButtonGroup>

            </Box>

            {/* [desktop] Multicast switch (under the Chat button) */}
            {isDesktop && props.isMulticast !== null && <ButtonMultiChatMemo multiChat={props.isMulticast} onSetMultiChat={props.setIsMulticast} />}

            {/* [desktop] secondary buttons (aligned to bottom for now, and mutually exclusive) */}
            {isDesktop && <Box sx={{ mt: 'auto', display: 'grid', gap: 1 }}>

              {/* [desktop] Call secondary button */}
              {showCall && <ButtonCallMemo disabled={!props.conversationId || !chatLLMId} onClick={handleCallClicked} />}

              {/* [desktop] Draw Options secondary button */}
              {isDraw && <ButtonOptionsDraw onClick={handleDrawOptionsClicked} />}

            </Box>}

          </Box>
        </Grid>

      </Grid>

      {/* Mode selector */}
      {!!chatModeMenuAnchor && (
        <ChatModeMenu
          anchorEl={chatModeMenuAnchor} onClose={handleModeSelectorHide}
          chatModeId={chatModeId} onSetChatModeId={handleModeChange}
          capabilityHasTTI={props.capabilityHasT2I}
        />
      )}

      {/* Camera */}
      {cameraCaptureComponent}

      {/* Actile */}
      {actileComponent}

    </Box>
  );
}