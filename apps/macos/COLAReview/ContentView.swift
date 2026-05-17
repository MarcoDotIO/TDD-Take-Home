import SwiftUI

struct ContentView: View {
    @State private var session: Session?
    @State private var isRegistering = false
    @State private var email = "applicant@example.gov"
    @State private var password = ""
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

    private var isAdmin: Bool {
        session?.roles.contains("admin") == true
    }

    var body: some View {
        if session == nil {
            loginView
        } else {
            NavigationSplitView {
                VStack(alignment: .leading, spacing: 16) {
                    if let session {
                        Text(session.email)
                        Text(isAdmin ? "Admin" : "Applicant")
                            .font(.caption)
                    }

                    if !isAdmin {
                        submissionForm
                    }

                    Button("Refresh") {
                        Task { await refresh() }
                    }

                    Button("Log out") {
                        session = nil
                        records = []
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
            }
        }
    }

    private var loginView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("Account", selection: $isRegistering) {
                Text("Login").tag(false)
                Text("Applicant Sign Up").tag(true)
            }
            .pickerStyle(.segmented)
            TextField("Email", text: $email)
            SecureField("Password", text: $password)
            Button(isRegistering ? "Create account" : "Login") {
                Task { await authenticate() }
            }
            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .frame(minWidth: 380)
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
                if isAdmin {
                    HStack {
                        Button("Approve") { Task { await override(record.id, status: .approved) } }
                        Button("Review") { Task { await override(record.id, status: .needsReview) } }
                        Button("Reject") { Task { await override(record.id, status: .rejected) } }
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .navigationTitle(isAdmin ? "Admin Queue" : "My Applications")
    }

    private func refresh() async {
        guard let session else { return }
        do {
            errorMessage = nil
            records = isAdmin
                ? try await api.listAdminSubmissions(session: session)
                : try await api.listApplicantSubmissions(session: session)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func submit() async {
        guard let session else { return }
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
                images: [ColaImage(id: UUID().uuidString, localPath: "front-label.png", url: nil, position: "front")]
            )
            _ = try await api.createSubmission(session: session, draft: draft)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func override(_ submissionId: String, status: DecisionStatus) async {
        guard let session else { return }
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

    private func authenticate() async {
        do {
            errorMessage = nil
            session = isRegistering
                ? try await api.registerApplicant(email: email, password: password)
                : try await api.login(email: email, password: password)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
