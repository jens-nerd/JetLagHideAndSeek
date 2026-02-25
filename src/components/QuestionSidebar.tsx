import { useStore } from "@nanostores/react";
import { SidebarCloseIcon } from "lucide-react";
import { useT } from "@/i18n";

import {
    Sidebar,
    SidebarContent,
    SidebarContext,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar-l";
import {
    autoSave,
    isLoading,
    questions,
    save,
    triggerLocalRefresh,
} from "@/lib/context";
import { hiderAreaConfirmed, pendingRole, sessionParticipant } from "@/lib/session-context";

import { AddQuestionDialog } from "./AddQuestionDialog";
import {
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "./QuestionCards";
import { HiderAreaSearch } from "./session/HiderAreaSearch";
import { RoleSelection } from "./session/RoleSelection";
import { SessionManager } from "./session/SessionManager";
import { useSessionMapSync } from "@/hooks/useSessionMapSync";
import { useMapLocationSync } from "@/hooks/useMapLocationSync";

export const QuestionSidebar = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);
    const $autoSave = useStore(autoSave);
    const $isLoading = useStore(isLoading);
    const $participant = useStore(sessionParticipant);
    const $pendingRole = useStore(pendingRole);
    const $hiderAreaConfirmed = useStore(hiderAreaConfirmed);
    const tr = useT();

    // Sync answered session questions into the local map
    useSessionMapSync();
    // Push hider's map location changes to the backend in real time
    useMapLocationSync();

    // Hide question editing UI when in a session:
    // - hider: never needs to add/edit questions
    // - seeker: uses the inline buttons in SessionQuestionPanel instead
    const isHider = $participant?.role === "hider";
    const isInSession = $participant !== null;

    return (
        <Sidebar>
            <div className="flex items-center justify-between">
                <h2 className="ml-4 mt-4 font-poppins text-2xl">{tr("sidebar.questions")}</h2>
                <SidebarCloseIcon
                    className="mr-2 visible md:hidden"
                    onClick={() => {
                        SidebarContext.get().setOpenMobile(false);
                    }}
                />
            </div>
            <SidebarGroup className="flex-1 min-h-0 overflow-y-auto">
                <SidebarGroupContent>
                    <div className="px-3 py-2">
                        {/* Onboarding flow:
                            1. No role chosen      → RoleSelection
                            2. Hider, area pending → HiderAreaSearch
                            3. Everything else     → SessionManager */}
                        {!isInSession && $pendingRole === null
                            ? <RoleSelection />
                            : !isInSession && $pendingRole === "hider" && !$hiderAreaConfirmed
                                ? <HiderAreaSearch />
                                : <SessionManager />
                        }
                    </div>
                </SidebarGroupContent>
            </SidebarGroup>
            {!isHider && !isInSession && (
                <SidebarContent>
                    {$questions.map((question) => {
                        switch (question.id) {
                            case "radius":
                                return (
                                    <RadiusQuestionComponent
                                        data={question.data}
                                        key={question.key}
                                        questionKey={question.key}
                                    />
                                );
                            case "thermometer":
                                return (
                                    <ThermometerQuestionComponent
                                        data={question.data}
                                        key={question.key}
                                        questionKey={question.key}
                                    />
                                );
                            case "tentacles":
                                return (
                                    <TentacleQuestionComponent
                                        data={question.data}
                                        key={question.key}
                                        questionKey={question.key}
                                    />
                                );
                            case "matching":
                                return (
                                    <MatchingQuestionComponent
                                        data={question.data}
                                        key={question.key}
                                        questionKey={question.key}
                                    />
                                );
                            case "measuring":
                                return (
                                    <MeasuringQuestionComponent
                                        data={question.data}
                                        key={question.key}
                                        questionKey={question.key}
                                    />
                                );
                            default:
                                return null;
                        }
                    })}
                </SidebarContent>
            )}
            <SidebarGroup>
                <SidebarGroupContent>
                    <SidebarMenu data-tutorial-id="add-questions-buttons">
                        {!isInSession && (
                            <SidebarMenuItem>
                                <AddQuestionDialog>
                                    <SidebarMenuButton disabled={$isLoading}>
                                        {tr("sidebar.addQuestion")}
                                    </SidebarMenuButton>
                                </AddQuestionDialog>
                            </SidebarMenuItem>
                        )}
                        <SidebarMenuItem>
                            <a
                                href="https://github.com/taibeled/JetLagHideAndSeek"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <SidebarMenuButton className="bg-emerald-600 transition-colors">
                                    {tr("sidebar.starOnGithub")}
                                </SidebarMenuButton>
                            </a>
                        </SidebarMenuItem>
                        {!$autoSave && (
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    className="bg-blue-600 p-2 rounded-md font-semibold font-poppins transition-shadow duration-500"
                                    onClick={save}
                                    disabled={$isLoading}
                                >
                                    {tr("options.save")}
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        )}
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        </Sidebar>
    );
};
