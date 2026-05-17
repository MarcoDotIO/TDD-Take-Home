import SwiftUI

struct ContentView: View {
    @State private var mode: UserMode = .applicant
    @State private var records: [SubmissionRecord] = []
    @State private var errorMessage: String?
    @State private var brandName = "OLD TOM DISTILLERY"
    @State private var productName = "Kentucky Straight Bourbon Whiskey"
    @State private var productType = "distilled spirits"
    @State private var className = "bourbon whisky"
    @State private var originName = "kentucky"
    @State private var abv = "45"
    @State private var volume = "750"

    private let api = APIClient()

    private var session: Session {
        switch mode {
        case .applicant:
            Session(userId: "applicant-local", email: "applicant@example.gov", roles: ["applicant"])
        case .admin:
            Session(userId: "admin-local", email: "admin@example.gov", roles: ["admin"])
        }
    }

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Mode", selection: $mode) {
                    ForEach(UserMode.allCases) { mode in
                        Text(mode.rawValue.capitalized).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                if mode == .applicant {
                    submissionForm
                }

                Button("Refresh") {
                    Task { await refresh() }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("COLA")
        } detail: {
            recordsView
                .task { await refresh() }
                .onChange(of: mode) { _ in Task { await refresh() } }
        }
    }

    private var submissionForm: some View {
        Form {
            TextField("Brand", text: $brandName)
            TextField("Product", text: $productName)
            Picker("Type", selection: $productType) {
                Text("Distilled spirits").tag("distilled spirits")
                Text("Malt beverage").tag("malt beverage")
                Text("Wine").tag("wine")
            }
            TextField("Class", text: $className)
            TextField("Origin", text: $originName)
            TextField("ABV", text: $abv)
            TextField("Volume", text: $volume)
            Button("Submit") {
                Task { await submit() }
            }
        }
    }

    private var recordsView: some View {
        List(records) { record in
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(record.submission.brandName).font(.headline)
                    Spacer()
                    Text(record.submission.status.replacingOccurrences(of: "_", with: " "))
                        .font(.caption)
                }
                Text(record.submission.productName)
                Text(record.decision?.rationale ?? "No automated decision")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if mode == .admin {
                    HStack {
                        Button("Approve") { Task { await override(record.id, status: .approved) } }
                        Button("Review") { Task { await override(record.id, status: .needsReview) } }
                        Button("Reject") { Task { await override(record.id, status: .rejected) } }
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .navigationTitle(mode == .admin ? "Admin Queue" : "My Applications")
    }

    private func refresh() async {
        do {
            errorMessage = nil
            records = mode == .admin
                ? try await api.listAdminSubmissions(session: session)
                : try await api.listApplicantSubmissions(session: session)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func submit() async {
        do {
            errorMessage = nil
            let draft = SubmissionDraft(
                brandName: brandName,
                productName: productName,
                productType: productType,
                className: className,
                originName: originName,
                domesticOrImported: "domestic",
                abv: Double(abv),
                volume: Double(volume),
                volumeUnit: "milliliters",
                images: [ColaImage(id: UUID().uuidString, localPath: "front-label.png", position: "front")]
            )
            _ = try await api.createSubmission(session: session, draft: draft)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func override(_ submissionId: String, status: DecisionStatus) async {
        do {
            _ = try await api.overrideSubmission(
                session: session,
                submissionId: submissionId,
                status: status,
                reason: "Native admin override to \(status.rawValue)"
            )
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
