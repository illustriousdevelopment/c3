use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const DEFAULT_FOREGROUND: &str = "#dce2e8";
const DEFAULT_BACKGROUND: &str = "#0b0d11";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnsiSpan {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub dim: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub underline: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedAnsi {
    pub plain: String,
    pub styled_lines: Vec<Vec<AnsiSpan>>,
    pub revision: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AnsiStyle {
    foreground: Option<String>,
    background: Option<String>,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

pub(crate) fn parse_ansi_capture(input: &str) -> ParsedAnsi {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);

    let mut plain = String::with_capacity(input.len());
    let mut lines: Vec<Vec<AnsiSpan>> = Vec::new();
    let mut line: Vec<AnsiSpan> = Vec::new();
    let mut text = String::new();
    let mut style = AnsiStyle::default();
    let mut characters = input.chars().peekable();

    while let Some(character) = characters.next() {
        match character {
            '\u{1b}' => {
                flush_span(&mut line, &mut text, &style);
                match characters.next() {
                    Some('[') => {
                        let mut parameters = String::new();
                        while let Some(next) = characters.next() {
                            if ('@'..='~').contains(&next) {
                                if next == 'm' {
                                    apply_sgr(&mut style, &parameters);
                                }
                                break;
                            }
                            parameters.push(next);
                        }
                    }
                    Some(']') => {
                        while let Some(next) = characters.next() {
                            if next == '\u{7}' {
                                break;
                            }
                            if next == '\u{1b}' && characters.peek() == Some(&'\\') {
                                characters.next();
                                break;
                            }
                        }
                    }
                    Some(_) | None => {}
                }
            }
            '\n' => {
                flush_span(&mut line, &mut text, &style);
                lines.push(std::mem::take(&mut line));
                plain.push('\n');
            }
            '\r' | '\u{7}' => {}
            _ => {
                text.push(character);
                plain.push(character);
            }
        }
    }

    flush_span(&mut line, &mut text, &style);
    if !line.is_empty() || !input.ends_with('\n') {
        lines.push(line);
    }

    ParsedAnsi {
        plain,
        styled_lines: lines,
        revision: format!("{:016x}", hasher.finish()),
    }
}

fn flush_span(line: &mut Vec<AnsiSpan>, text: &mut String, style: &AnsiStyle) {
    if text.is_empty() {
        return;
    }
    let (foreground, background) = if style.inverse {
        (
            Some(
                style
                    .background
                    .clone()
                    .unwrap_or_else(|| DEFAULT_BACKGROUND.to_string()),
            ),
            Some(
                style
                    .foreground
                    .clone()
                    .unwrap_or_else(|| DEFAULT_FOREGROUND.to_string()),
            ),
        )
    } else {
        (style.foreground.clone(), style.background.clone())
    };
    line.push(AnsiSpan {
        text: std::mem::take(text),
        foreground,
        background,
        bold: style.bold,
        dim: style.dim,
        italic: style.italic,
        underline: style.underline,
    });
}

fn apply_sgr(style: &mut AnsiStyle, raw_parameters: &str) {
    let parameters = parse_parameters(raw_parameters);
    let mut index = 0;
    while index < parameters.len() {
        match parameters[index] {
            0 => *style = AnsiStyle::default(),
            1 => style.bold = true,
            2 => style.dim = true,
            3 => style.italic = true,
            4 => style.underline = true,
            7 => style.inverse = true,
            22 => {
                style.bold = false;
                style.dim = false;
            }
            23 => style.italic = false,
            24 => style.underline = false,
            27 => style.inverse = false,
            30..=37 => style.foreground = Some(ansi_palette((parameters[index] - 30) as u8)),
            38 => {
                if let Some((color, consumed)) = extended_color(&parameters[index + 1..]) {
                    style.foreground = Some(color);
                    index += consumed;
                }
            }
            39 => style.foreground = None,
            40..=47 => style.background = Some(ansi_palette((parameters[index] - 40) as u8)),
            48 => {
                if let Some((color, consumed)) = extended_color(&parameters[index + 1..]) {
                    style.background = Some(color);
                    index += consumed;
                }
            }
            49 => style.background = None,
            90..=97 => {
                style.foreground = Some(ansi_palette((parameters[index] - 90 + 8) as u8))
            }
            100..=107 => {
                style.background = Some(ansi_palette((parameters[index] - 100 + 8) as u8))
            }
            _ => {}
        }
        index += 1;
    }
}

fn parse_parameters(raw: &str) -> Vec<u16> {
    if raw.is_empty() {
        return vec![0];
    }
    let parsed: Vec<u16> = raw
        .split([';', ':'])
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u16>().ok())
        .collect();
    if parsed.is_empty() {
        vec![0]
    } else {
        parsed
    }
}

fn extended_color(parameters: &[u16]) -> Option<(String, usize)> {
    match parameters {
        [5, index, ..] if *index <= 255 => Some((ansi_palette(*index as u8), 2)),
        [2, red, green, blue, ..] if *red <= 255 && *green <= 255 && *blue <= 255 => {
            Some((format!("#{red:02x}{green:02x}{blue:02x}"), 4))
        }
        _ => None,
    }
}

fn ansi_palette(index: u8) -> String {
    const BASE: [&str; 16] = [
        "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd",
        "#e5e5e5", "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff",
        "#00ffff", "#ffffff",
    ];
    if index < 16 {
        return BASE[index as usize].to_string();
    }
    if index < 232 {
        let offset = index - 16;
        let red = cube_component(offset / 36);
        let green = cube_component((offset % 36) / 6);
        let blue = cube_component(offset % 6);
        return format!("#{red:02x}{green:02x}{blue:02x}");
    }
    let gray = 8 + (index - 232) * 10;
    format!("#{gray:02x}{gray:02x}{gray:02x}")
}

fn cube_component(value: u8) -> u8 {
    if value == 0 {
        0
    } else {
        55 + value * 40
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_truecolor_and_text_attributes() {
        let parsed = parse_ansi_capture(
            "plain \u{1b}[1;3;4;38;2;113;183;239mstyled\u{1b}[0m done\n",
        );
        assert_eq!(parsed.plain, "plain styled done\n");
        assert_eq!(parsed.styled_lines.len(), 1);
        assert_eq!(parsed.styled_lines[0].len(), 3);
        let styled = &parsed.styled_lines[0][1];
        assert_eq!(styled.foreground.as_deref(), Some("#71b7ef"));
        assert!(styled.bold);
        assert!(styled.italic);
        assert!(styled.underline);
    }

    #[test]
    fn maps_256_color_and_resets_selectively() {
        let parsed = parse_ansi_capture("\u{1b}[38;5;208;48;5;236mhot\u{1b}[39m bg");
        assert_eq!(parsed.styled_lines[0][0].foreground.as_deref(), Some("#ff8700"));
        assert_eq!(parsed.styled_lines[0][0].background.as_deref(), Some("#303030"));
        assert_eq!(parsed.styled_lines[0][1].foreground, None);
        assert_eq!(parsed.styled_lines[0][1].background.as_deref(), Some("#303030"));
    }

    #[test]
    fn strips_osc_links_and_control_sequences() {
        let parsed = parse_ansi_capture(
            "before \u{1b}]8;;https://example.com\u{1b}\\link\u{1b}]8;;\u{1b}\\ after",
        );
        assert_eq!(parsed.plain, "before link after");
        assert_eq!(
            parsed.styled_lines[0]
                .iter()
                .map(|span| span.text.as_str())
                .collect::<String>(),
            "before link after"
        );
    }

    #[test]
    fn resolves_inverse_against_terminal_defaults() {
        let parsed = parse_ansi_capture("\u{1b}[7minverse\u{1b}[27m");
        let span = &parsed.styled_lines[0][0];
        assert_eq!(span.foreground.as_deref(), Some(DEFAULT_BACKGROUND));
        assert_eq!(span.background.as_deref(), Some(DEFAULT_FOREGROUND));
    }

    #[test]
    fn revision_changes_only_with_capture_content() {
        let first = parse_ansi_capture("same");
        let second = parse_ansi_capture("same");
        let changed = parse_ansi_capture("different");
        assert_eq!(first.revision, second.revision);
        assert_ne!(first.revision, changed.revision);
    }
}
