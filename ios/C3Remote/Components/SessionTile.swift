import SwiftUI

struct SessionTile: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let session: RemoteSession

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                Text(session.displayName)
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundStyle(.primary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Circle()
                    .fill(session.state.tint)
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)
                    .accessibilityHidden(true)
            }

            Text(session.projectLeaf)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                .padding(.top, 5)

            Spacer(minLength: 14)

            Text(session.state.label)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
                .tracking(0.7)

            Text(session.attentionText)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 3)
                .multilineTextAlignment(.leading)
                .padding(.top, 5)

            Spacer(minLength: 12)

            Text((session.agentKind ?? "agent").lowercased())
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, minHeight: 176, alignment: .leading)
        .padding(14)
        .background(Color(uiColor: .secondarySystemBackground))
        .overlay {
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color(uiColor: .separator), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(session.displayName), \(session.state.label), \(session.attentionText)")
    }
}
