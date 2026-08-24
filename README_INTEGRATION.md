# Intégration du module pointage (photo + QR + localisation)

## ⚠️ Sécurité — à faire en premier

Ta clé Resend (`re_5Msq28vS_MrstFgRkXSNHeH6oCvxNDYTk`) a été collée en clair dans
cette conversation, donc considère-la comme compromise :

1. Va sur resend.com → API Keys → révoque cette clé.
2. Crée-en une nouvelle.
3. Ne la mets plus jamais dans le code. Exporte-la en variable d'environnement :
   ```bash
   export RESEND_API_KEY="re_ta_nouvelle_cle"
   export ATTENDANCE_ALERT_EMAIL="admin@tondomaine.com"
   ```
`email.go` (fourni ici) lit ces deux variables — il n'y a plus de clé en dur.

## 1. Fichiers à copier dans ton dossier backend

- `attendance.go`
- `email.go`

(Ils sont `package main`, donc ils rejoignent directement ton `main.go` existant.)

## 2. Migration base de données

Exécute `migration.sql` sur ta base `snase`. Il ajoute `photo_path`,
`latitude`, `longitude`, `location_label` à `attendance`, et surtout la
contrainte `UNIQUE(employee_id, attendance_date)` — c'est elle qui garantit
"un seul pointage par jour", y compris en cas de double-scan simultané.

```bash
mysql -u root -p snase < migration.sql
```

## 3. Modifications dans `main.go`

### a) Appeler `ensureUploadsDir()` dans `main()`

```go
func main() {
	connectDB()
	ensureUploadsDir()   // <-- ajouter cette ligne
	setupRoutes()
	...
}
```

### b) Ajouter les nouvelles routes dans `setupRoutes()`

```go
func setupRoutes() {

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "API SNASE fonctionne !")
	})

	http.HandleFunc("/api/login", loginHandler)

	http.HandleFunc("/api/employees", employeesHandler)
	http.HandleFunc("/api/employees/", employeesHandler)

	http.HandleFunc("/api/payments", getAllPayments)
	http.HandleFunc("/api/employee-payments/", getPayments)
	http.HandleFunc("/api/employee-advances/", employeeAdvancesHandler)
	http.HandleFunc("/api/employee-attendance/", getAttendance)

	// --- Nouveau : module pointage QR + photo + localisation ---
	http.HandleFunc("/api/employees/by-code", getEmployeeByCode)
	http.HandleFunc("/api/attendance", createAttendanceHandler)
	http.HandleFunc("/api/attendance-history", getAttendanceHistoryHandler)

	// Sert les photos de pointage enregistrées sur le disque
	http.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("./uploads"))))

	// Sert le frontend (dossier frontend/ fourni à part)
	http.Handle("/app/", http.StripPrefix("/app/", http.FileServer(http.Dir("./frontend"))))
}
```

## 4. Dépendance Go

Tu utilises déjà `resend-go` dans ton script séparé — ajoute-le au module
principal :

```bash
go get github.com/resend/resend-go/v2
go mod tidy
```

## 5. Nouvelles routes disponibles

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/employees/by-code?code=EMP001` | Retrouve un employé à partir du contenu scanné du QR code (`employee_code`) |
| POST | `/api/attendance` | Multipart : `employee_id`, `recorded_by`, `latitude`, `longitude`, `location_label`, `photo` (fichier). Crée le pointage, ou renvoie `409` + envoie un mail si l'employé est déjà pointé aujourd'hui |
| GET | `/api/attendance-history?recorded_by=3&search=` | Historique des pointages effectués par l'utilisateur `3` uniquement |

## 6. Comment fonctionne la règle "un seul pointage par jour"

Le backend ne fait pas juste "je vérifie avant d'insérer" (ce qui laisserait
une brèche si deux personnes scannent le même employé au même moment) : il
tente directement l'`INSERT`, et la contrainte SQL `UNIQUE(employee_id, attendance_date)`
rejette l'insertion si elle existe déjà. Le code Go détecte cette erreur
MySQL précise (n° 1062) et, seulement dans ce cas :
- n'écrit pas la photo sur le disque (pas de fichier orphelin),
- déclenche l'e-mail d'alerte,
- répond `409 Conflict` au frontend.

## 7. QR code des employés

Le contenu du QR code à imprimer/afficher pour chaque employé est simplement
sa valeur `employee_code`. Le frontend le scanne côté navigateur (caméra) et
appelle `/api/employees/by-code?code=...`. Aucune génération de QR n'est
nécessaire côté backend — n'importe quel générateur de QR à partir d'une
chaîne de texte suffit pour imprimer les badges.
