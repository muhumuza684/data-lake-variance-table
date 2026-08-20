"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * General card: font family, font size, base row height.
 */
class GeneralSettingsCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.TextInput({
        name: "fontFamily",
        displayName: "Font family",
        displayNameKey: "Prop_FontFamily",
        placeholder: "Segoe UI, sans-serif",
        value: "Segoe UI, sans-serif"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        displayNameKey: "Prop_FontSize",
        value: 12
    });

    rowHeight = new formattingSettings.NumUpDown({
        name: "rowHeight",
        displayName: "Row height",
        displayNameKey: "Prop_RowHeight",
        value: 32
    });

    name: string = "general";
    displayName: string = "General";
    displayNameKey: string = "Object_General";
    slices: FormattingSettingsSlice[] = [this.fontFamily, this.fontSize, this.rowHeight];
}

/**
 * Header card: background, text color, bold.
 */
class HeaderSettingsCard extends FormattingSettingsCard {
    bgColor = new formattingSettings.ColorPicker({
        name: "bgColor",
        displayName: "Background color",
        displayNameKey: "Prop_BgColor",
        value: { value: "#F0F2F5" }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Font color",
        displayNameKey: "Prop_FontColor",
        value: { value: "#333333" }
    });

    bold = new formattingSettings.ToggleSwitch({
        name: "bold",
        displayName: "Bold",
        displayNameKey: "Prop_Bold",
        value: true
    });

    name: string = "header";
    displayName: string = "Header";
    displayNameKey: string = "Object_Header";
    slices: FormattingSettingsSlice[] = [this.bgColor, this.fontColor, this.bold];
}

/**
 * Cells card: background, text color, alternate (zebra) row color.
 */
class CellsSettingsCard extends FormattingSettingsCard {
    bgColor = new formattingSettings.ColorPicker({
        name: "bgColor",
        displayName: "Background color",
        displayNameKey: "Prop_BgColor",
        value: { value: "#FFFFFF" }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Font color",
        displayNameKey: "Prop_FontColor",
        value: { value: "#333333" }
    });

    alternateRowColor = new formattingSettings.ColorPicker({
        name: "alternateRowColor",
        displayName: "Alternate row color",
        displayNameKey: "Prop_AlternateRowColor",
        value: { value: "#FAFAFA" }
    });

    name: string = "cells";
    displayName: string = "Cells";
    displayNameKey: string = "Object_Cells";
    slices: FormattingSettingsSlice[] = [this.bgColor, this.fontColor, this.alternateRowColor];
}

/**
 * In-cell data bars card.
 */
class DataBarsSettingsCard extends FormattingSettingsCard {
    enableDataBars = new formattingSettings.ToggleSwitch({
        name: "enableDataBars",
        displayName: "Show data bars",
        displayNameKey: "Prop_EnableDataBars",
        value: false
    });

    barColor = new formattingSettings.ColorPicker({
        name: "barColor",
        displayName: "Bar color",
        displayNameKey: "Prop_BarColor",
        value: { value: "#0078D4" }
    });

    name: string = "formatting";
    displayName: string = "Data bars";
    displayNameKey: string = "Object_DataBars";
    slices: FormattingSettingsSlice[] = [this.enableDataBars, this.barColor];
}

/**
 * Totals row card.
 */
class TotalsSettingsCard extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show totals row",
        displayNameKey: "Prop_ShowTotals",
        value: false
    });

    label = new formattingSettings.TextInput({
        name: "label",
        displayName: "Label",
        displayNameKey: "Prop_TotalsLabel",
        placeholder: "Total",
        value: "Total"
    });

    bgColor = new formattingSettings.ColorPicker({
        name: "bgColor",
        displayName: "Background color",
        displayNameKey: "Prop_BgColor",
        value: { value: "#F0F2F5" }
    });

    name: string = "totals";
    displayName: string = "Totals";
    displayNameKey: string = "Object_Totals";
    slices: FormattingSettingsSlice[] = [this.show, this.label, this.bgColor];
}

/**
 * Virtual scrolling card. On by default -- performance-as-default, never
 * something the user has to discover or configure to get a smooth table.
 */
class VirtualScrollingSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Enabled",
        displayNameKey: "Prop_Enabled",
        value: true
    });

    rowHeight = new formattingSettings.NumUpDown({
        name: "rowHeight",
        displayName: "Row height",
        displayNameKey: "Prop_RowHeight",
        value: 35
    });

    name: string = "virtualScrolling";
    displayName: string = "Smooth scrolling";
    displayNameKey: string = "Object_VirtualScrolling";
    slices: FormattingSettingsSlice[] = [this.enabled, this.rowHeight];
}

/**
 * Toolbar visibility card.
 */
class ToolbarSettingsCard extends FormattingSettingsCard {
    showMenu = new formattingSettings.ToggleSwitch({
        name: "showMenu",
        displayName: "Show toolbar",
        displayNameKey: "Prop_ShowMenu",
        value: true
    });

    name: string = "toolbar";
    displayName: string = "Toolbar";
    displayNameKey: string = "Object_Toolbar";
    slices: FormattingSettingsSlice[] = [this.showMenu];
}

/**
 * Search visibility card.
 */
class SearchSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Enable search",
        displayNameKey: "Prop_EnableSearch",
        value: true
    });

    name: string = "search";
    displayName: string = "Search";
    displayNameKey: string = "Object_Search";
    slices: FormattingSettingsSlice[] = [this.enabled];
}

/**
 * Grouping card: whether multi-level groups (from the "Group by" role)
 * start expanded or collapsed.
 */
class GroupingSettingsCard extends FormattingSettingsCard {
    defaultExpanded = new formattingSettings.ToggleSwitch({
        name: "defaultExpanded",
        displayName: "Expand groups by default",
        displayNameKey: "Prop_DefaultExpanded",
        value: true
    });

    name: string = "grouping";
    displayName: string = "Grouping";
    displayNameKey: string = "Object_Grouping";
    slices: FormattingSettingsSlice[] = [this.defaultExpanded];
}

/**
 * Column filters card: toggles the small filter icon in each header cell
 * that opens a type-aware filter popover (text / number / date).
 */
class FiltersSettingsCard extends FormattingSettingsCard {
    showIcons = new formattingSettings.ToggleSwitch({
        name: "showIcons",
        displayName: "Show column filter icons",
        displayNameKey: "Prop_ShowFilterIcons",
        value: true
    });

    name: string = "filters";
    displayName: string = "Column filters";
    displayNameKey: string = "Object_Filters";
    slices: FormattingSettingsSlice[] = [this.showIcons];
}

/**
 * Conditional formatting card: a two-color scale applied to measure cells
 * based on that column's min/max across the full (unfiltered) dataset.
 */
class ConditionalFormattingSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Enable color scale",
        displayNameKey: "Prop_EnableColorScale",
        value: false
    });

    minColor = new formattingSettings.ColorPicker({
        name: "minColor",
        displayName: "Low color",
        displayNameKey: "Prop_MinColor",
        value: { value: "#FDE2E2" }
    });

    maxColor = new formattingSettings.ColorPicker({
        name: "maxColor",
        displayName: "High color",
        displayNameKey: "Prop_MaxColor",
        value: { value: "#2E7D32" }
    });

    name: string = "conditionalFormatting";
    displayName: string = "Conditional formatting";
    displayNameKey: string = "Object_ConditionalFormatting";
    slices: FormattingSettingsSlice[] = [this.enabled, this.minColor, this.maxColor];
}

/**
 * Conditional URL actions card. Rules are authored as a JSON array (Power BI's
 * formatting pane doesn't support arbitrary user-added rows in a repeating UI),
 * evaluated top-to-bottom per row, first match wins. See ILinkActionRule in
 * tableRenderer.ts for the exact shape.
 *
 * `validationMessage` is a read-only slice that visual.ts toggles visible only
 * when the JSON in `rules` fails to parse or doesn't match the expected shape --
 * malformed input never throws or breaks rendering, it just quietly disables the
 * link-action feature and surfaces this one plain-language note in the pane.
 */
class ExportGovernanceSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({ name: "enabled", displayName: "Enable export watermark", value: false });
    watermarkText = new formattingSettings.TextInput({ name: "watermarkText", displayName: "Watermark text", placeholder: "CONFIDENTIAL", value: "CONFIDENTIAL" });
    locale = new formattingSettings.TextInput({ name: "locale", displayName: "Locale", placeholder: "en-UG", value: "en-UG" });
    currency = new formattingSettings.TextInput({ name: "currency", displayName: "Currency code", placeholder: "UGX", value: "UGX" });
    username = new formattingSettings.TextInput({ name: "username", displayName: "Audit username", placeholder: "Power BI username", value: "" });
    name: string = "exportGovernance";
    displayName: string = "Export governance";
    slices: FormattingSettingsSlice[] = [this.enabled, this.watermarkText, this.locale, this.currency, this.username];
}
class LinkActionsSettingsCard extends FormattingSettingsCard {
    rules = new formattingSettings.TextArea({
        name: "rules",
        displayName: "Link rules (JSON)",
        placeholder: '[{"column":"Status","operator":"equals","value":"Overdue","urlTemplate":"https://portal.example.com/case/{CaseID}"}]',
        value: ""
    });

    iconColumn = new formattingSettings.TextInput({
        name: "iconColumn",
        displayName: "Icon column",
        placeholder: "Exact column name to show the link icon in",
        value: ""
    });

    validationMessage = new formattingSettings.ReadOnlyText({
        name: "validationMessage",
        displayName: "",
        value: "Check the formatting of your link rules",
        visible: false
    });

    name: string = "linkActions";
    displayName: string = "Link actions";
    slices: FormattingSettingsSlice[] = [this.rules, this.iconColumn, this.validationMessage];
}

/**
 * Top level formatting settings model, aggregating every card above.
 * Consumed by FormattingSettingsService in visual.ts.
 */
export class VisualSettingsModel extends FormattingSettingsModel {
    general = new GeneralSettingsCard();
    header = new HeaderSettingsCard();
    cells = new CellsSettingsCard();
    formatting = new DataBarsSettingsCard();
    totals = new TotalsSettingsCard();
    virtualScrolling = new VirtualScrollingSettingsCard();
    toolbar = new ToolbarSettingsCard();
    search = new SearchSettingsCard();
    grouping = new GroupingSettingsCard();
    filters = new FiltersSettingsCard();
    conditionalFormatting = new ConditionalFormattingSettingsCard();
    exportGovernance = new ExportGovernanceSettingsCard();
    linkActions = new LinkActionsSettingsCard();

    cards: FormattingSettingsCard[] = [
        this.general,
        this.header,
        this.cells,
        this.formatting,
        this.totals,
        this.virtualScrolling,
        this.toolbar,
        this.search,
        this.grouping,
        this.filters,
        this.conditionalFormatting,
        this.exportGovernance,
        this.linkActions
    ];
}
